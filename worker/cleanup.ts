import type { Env, R2Object } from './worker';
import { GitHub, GitHubError, shaPattern } from './github';
import config from '../moderation.config.json';
import { managedKeyPattern, submissionIdPattern } from '../scripts/moderation-policy.mjs';

const CURSOR = 'moderation-control/scan-v1.json';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({event, ...fields}));
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
// Pre-launch conservative policy: a PR is a durable hold, regardless of its
// state or age. Cron never closes PRs or writes refs. Explicit owner review and
// per-key removal handle rejection/expiry; a close alone is not rejection proof.
async function processObject(env: Env, object: R2Object, now: number): Promise<void> {
  const id = provenance(object);
  if (!id) { log('cleanup_retain_untrusted'); return; }
  const orphanGrace = setting(env.CLEANUP_ORPHAN_DAYS, 7, 1, 365) * DAY;
  const github = new GitHub(env);
  if (await published(github, id, object.key)) { log('cleanup_retain_approved', {id}); return; }
  const pr = await github.submissionPull(id, object.key);
  if (pr) {
    verifyPR(pr, env);
    log('cleanup_retain_submission', {id, state: pr.state});
    return;
  }
  if (now - object.uploaded.getTime() < orphanGrace) { log('cleanup_retain_orphan_grace', {id}); return; }
  const branchPath = `/git/ref/heads/submission/${id}`;
  if (await github.request('GET', branchPath, undefined, true) !== null) {
    log('cleanup_retain_branch', {id}); return;
  }
  if (env.CLEANUP_MODE !== 'active') { log('cleanup_would_delete', {id, reason: 'orphan'}); return; }
  // Re-read the positive never-created association and all authoritative state.
  // A remaining branch (including one reused by unrelated work) is a hold;
  // cleanup does not attempt to infer its history or "retire" it.
  if (await github.submissionPull(id, object.key) !== null
    || await github.request('GET', branchPath, undefined, true) !== null) {
    log('cleanup_retain_changed_submission', {id}); return;
  }
  if (await published(github, id, object.key)) { log('cleanup_retain_racing_publication', {id}); return; }
  const current = await env.BUCKET.head(object.key);
  if (!current) { log('cleanup_already_deleted', {id}); return; }
  if (current.etag !== object.etag || provenance(current) !== id) throw new Error('object_changed_during_cleanup');
  await env.BUCKET.delete(object.key);
  log('cleanup_deleted', {id, reason: 'orphan', github_calls: github.calls});
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
