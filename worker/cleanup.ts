import type { Env, R2Object } from './worker';
import { GitHub, GitHubError, shaPattern } from './github';
import config from '../moderation.config.json';
import { managedKeyPattern, submissionIdPattern } from '../scripts/moderation-policy.mjs';

const CURSOR = 'moderation-control/scan-v1.json';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const INACTIVE = 30 * DAY;
const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({event, ...fields}));
const date = (s: unknown): number => {
  if (typeof s !== 'string' || !Number.isFinite(Date.parse(s))) throw new Error('invalid_github_timestamp');
  return Date.parse(s);
};
const setting = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('invalid_retention_setting');
  return n;
};
function provenance(object: R2Object): string | null {
  const match = managedKeyPattern.exec(object.key);
  const m = object.customMetadata;
  if (!match || !submissionIdPattern.test(match[1]) || m?.moderation_schema !== '1'
    || m.submission_id !== match[1] || !Number.isFinite(Date.parse(m.created_at))
    || m.created_at !== new Date(m.created_at).toISOString() || !Number.isFinite(object.uploaded.getTime())
    || Math.abs(Date.parse(m.created_at) - object.uploaded.getTime()) > HOUR) return null;
  return match[1];
}
function verifyPR(pr: any, env: Env) {
  if (!pr || !Number.isSafeInteger(pr.number) || pr.number <= 0 || !['open', 'closed'].includes(pr.state)
    || typeof pr.merged !== 'boolean' || !shaPattern.test(pr.head?.sha)
    || pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`
    || pr.user?.login !== config.submission_author
    || typeof pr.head?.ref !== 'string' || !pr.head.ref || pr.head.ref === 'main'
    || pr.head?.repo?.full_name !== `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`) throw new Error('untrusted_pr_state');
}
async function published(github: GitHub, id: string, key: string): Promise<boolean> {
  const main = await github.main();
  const catalog = await github.catalog(main);
  const receipt = await github.json(`submissions/${id}.json`, main, true);
  // Any receipt, even malformed, is a conservative permanent approval marker.
  // Catalog references are checked independently, including legacy IDs.
  return receipt !== null || catalog.some(r => {
    if (r.id === id) return true;
    const url = new URL(r.asset_url);
    return url.origin === config.asset_base_url && decodeURIComponent(url.pathname).slice(1) === key;
  });
}
function expirationMarker(pr: any): string {
  return `<!-- root-archive-expiration:v1:${pr.head.sha} -->`;
}
async function activity(github: GitHub, pr: any, now: number): Promise<{active: boolean; comment?: any}> {
  const cutoff = new Date(now - INACTIVE).toISOString();
  if (date(pr.created_at) > now - INACTIVE) return {active: true};
  const comments = await github.request('GET', `/issues/${pr.number}/comments?since=${cutoff}&per_page=100`);
  if (!Array.isArray(comments) || comments.length >= 100) throw new Error('activity_comments_incomplete');
  const automatic = (c: any) => c.user?.login === config.submission_author
    && typeof c.body === 'string' && c.body.startsWith(expirationMarker(pr));
  if (comments.some(c => !automatic(c))) return {active: true};
  // Our explanation must not restart the inactivity clock after a transient
  // close failure. Reuse its ID on retry, while counting all real activity.
  const comment = comments.filter(automatic).sort((a, b) => date(b.created_at) - date(a.created_at))[0];
  if (date(pr.updated_at) > now - INACTIVE && (!comment || date(pr.updated_at) > date(comment.created_at))) return {active: true};
  for (let page = 1; page <= 4; page++) {
    const reviews = await github.request('GET', `/pulls/${pr.number}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(reviews)) throw new Error('invalid_reviews');
    if (reviews.some(r => r.state === 'PENDING' || date(r.submitted_at) > now - INACTIVE)) return {active: true};
    if (reviews.length < 100) break;
    if (page === 4) throw new Error('activity_reviews_incomplete');
  }
  const inline = await github.request('GET', `/pulls/${pr.number}/comments?sort=updated&direction=desc&per_page=1`);
  if (!Array.isArray(inline)) throw new Error('invalid_review_comments');
  return {active: inline.some(c => date(c.updated_at) > now - INACTIVE), comment};
}

// Advance the rejected/orphan branch to a deliberately invalid publication
// head before deleting. Required current-head checks now block reopening and
// merging an old successful proposal. This is idempotent across Cron overlap.
async function retire(github: GitHub, id: string, closedHead?: string, branch = `submission/${id}`): Promise<string | null> {
  const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
  const refPath = `/git/ref/heads/${encodedBranch}`;
  const ref = await github.request('GET', refPath, undefined, true);
  if (ref === null && !closedHead) return null;
  const parent = ref === null ? closedHead : ref?.object?.sha;
  if (!shaPattern.test(parent) || (ref && (ref.object.type !== 'commit'
    || ref.ref !== `refs/heads/${branch}`))) throw new Error('invalid_submission_ref');
  const path = `submissions/retired/${id}.json`;
  const marker = await github.json(path, parent, true);
  if (marker !== null) {
    if (marker.id !== id || marker.retired !== true) throw new Error('invalid_retirement_marker');
    return parent;
  }
  const commit = await github.commitFiles(parent, [{path, content: JSON.stringify({id, retired: true}) + '\n'}], `Retire unpublished submission ${id}`);
  // Non-force update rejects diverged concurrent edits. Never alter main.
  if (ref === null) {
    // A deleted rejected branch must also become terminal before deletion.
    await github.request('POST', '/git/refs', {ref: `refs/heads/${branch}`, sha: commit});
  } else {
    await github.request('PATCH', `/git/refs/heads/${encodedBranch}`, {sha: commit, force: false});
  }
  const confirmed = await github.request('GET', refPath);
  if (confirmed?.object?.sha !== commit) throw new Error('retirement_not_confirmed');
  return commit;
}

async function processObject(env: Env, object: R2Object, now: number): Promise<void> {
  const id = provenance(object);
  if (!id) { log('cleanup_retain_untrusted'); return; }
  const orphanGrace = setting(env.CLEANUP_ORPHAN_DAYS, 7, 1, 365) * DAY;
  const rejectionGrace = setting(env.CLEANUP_REJECTED_HOURS, 12, 1, 168) * HOUR;
  const github = new GitHub(env);
  if (await published(github, id, object.key)) { log('cleanup_retain_approved', {id}); return; }
  const pr = await github.submissionPull(id, object.key);
  if (pr) {
    verifyPR(pr, env);
    if (pr.merged || pr.merged_at !== null) { log('cleanup_retain_merged', {id}); return; }
    if (pr.state === 'open') {
      const inactivity = await activity(github, pr, now);
      if (inactivity.active) { log('cleanup_retain_active', {id}); return; }
      if (env.CLEANUP_MODE !== 'active') { log('cleanup_would_expire', {id}); return; }
      const comment = inactivity.comment ?? await github.request('POST', `/issues/${pr.number}/comments`, {
        body: `${expirationMarker(pr)}\nThis submission has had no activity for 30 days. It is being closed; the unpublished upload may be removed after ${rejectionGrace / HOUR} hours. Please resubmit if review is still needed.`,
      });
      if (!Number.isSafeInteger(comment?.id)) throw new Error('expiration_comment_unconfirmed');
      const fresh = await github.request('GET', `/pulls/${pr.number}`);
      verifyPR(fresh, env);
      if (fresh.state !== 'open' || fresh.merged || fresh.head.sha !== pr.head.sha || fresh.head.ref !== pr.head.ref
        || date(fresh.updated_at) > date(comment.created_at) || (await activity(github, fresh, now)).active) {
        log('cleanup_expiration_cancelled', {id}); return;
      }
      await github.request('PATCH', `/pulls/${pr.number}`, {state: 'closed'});
      const closed = await github.request('GET', `/pulls/${pr.number}`);
      verifyPR(closed, env);
      if (closed.state !== 'closed' || closed.merged || closed.merged_at !== null) throw new Error('expiration_close_unconfirmed');
      log('cleanup_expired', {id});
      return; // Always begin a new rejection grace after a confirmed close.
    }
    if (date(pr.closed_at) > now - rejectionGrace) { log('cleanup_retain_rejection_grace', {id}); return; }
  } else if (now - object.uploaded.getTime() < orphanGrace) {
    log('cleanup_retain_orphan_grace', {id}); return;
  }
  if (env.CLEANUP_MODE !== 'active') { log('cleanup_would_delete', {id, reason: pr ? 'rejected' : 'orphan'}); return; }

  const retiredHead = await retire(github, id, pr?.head.sha, pr?.head.ref);
  const final = await github.submissionPull(id, object.key);
  if ((pr?.number ?? null) !== (final?.number ?? null)) throw new Error('submission_prs_changed');
  if (pr) {
    verifyPR(final, env);
    if (final.state !== 'closed' || final.merged || final.merged_at !== null
      || final.closed_at !== pr.closed_at || final.head.ref !== pr.head.ref
      // GitHub may keep the closed PR's old head snapshot until reopening.
      || ![pr.head.sha, retiredHead].includes(final.head.sha)) throw new Error('submission_state_changed');
  }
  // Fresh, uncached GitHub state AFTER branch retirement protects merges racing
  // with cleanup. Approval receipts are never removed by normal maintenance.
  if (await published(github, id, object.key)) { log('cleanup_retain_racing_publication', {id}); return; }
  const current = await env.BUCKET.head(object.key);
  if (!current) { log('cleanup_already_deleted', {id}); return; }
  if (current.etag !== object.etag || provenance(current) !== id) throw new Error('object_changed_during_cleanup');
  await env.BUCKET.delete(object.key);
  log('cleanup_deleted', {id, reason: pr ? 'rejected' : 'orphan', github_calls: github.calls});
}

export async function runCleanup(env: Env, now = Date.now()): Promise<void> {
  if (!env.CLEANUP_MODE || env.CLEANUP_MODE === 'off') return;
  if (!['dry-run', 'active'].includes(env.CLEANUP_MODE) || env.R2_PUBLIC_BASE_URL !== config.asset_base_url) {
    log('cleanup_configuration_error'); return;
  }
  try {
    const control = await env.BUCKET.get(CURSOR);
    const state = control ? await control.json() : {schema: 1};
    if (state.schema !== 1 || (state.cursor !== undefined && typeof state.cursor !== 'string')) throw new Error('invalid_scan_cursor');
    // One key per invocation bounds worst-case R2 + GitHub subrequests below
    // the Workers Free limit of 50. CAS prevents overlapping scans regressing it.
    const page = await env.BUCKET.list({prefix: 'assets/v1/', limit: 1, cursor: state.cursor, include: ['customMetadata']});
    if (page.objects.length > 1 || (page.truncated && !page.cursor)) throw new Error('invalid_r2_listing');
    for (const object of page.objects) {
      try { await processObject(env, object, now); }
      catch (error) { log('cleanup_retry', {id: provenance(object) ?? undefined, code: error instanceof GitHubError ? `github_http_${error.status}`
        : error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'storage_or_processing_failure'}); }
    }
    const result = await env.BUCKET.put(CURSOR, JSON.stringify({schema: 1, cursor: page.truncated ? page.cursor : undefined,
      last_scan_at: new Date(now).toISOString()}), {
      httpMetadata: {contentType: 'application/json', cacheControl: 'no-store'},
      onlyIf: control ? {etagMatches: control.etag} : {etagDoesNotMatch: '*'},
    });
    log(result ? 'cleanup_scan_advanced' : 'cleanup_scan_overlap', {scanned: page.objects.length, wrapped: !page.truncated});
  } catch (error) {
    log('cleanup_scan_failed', {code: error instanceof GitHubError ? `github_http_${error.status}` : 'storage_or_cursor_failure'});
  }
}
