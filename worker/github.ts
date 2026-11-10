import type { Env } from './worker';
import { validateCatalogs } from '../scripts/catalog-policy.mjs';

export const shaPattern = /^[0-9a-f]{40}$/;
export const associationKey = (id: string) => `moderation-control/submissions/${id}.json`;
type Association = {submission_id: string; object_key: string;
  phase: 'not-created' | 'creating' | 'linked'; pr_number?: number};

// Persist intent BEFORE the PR POST and its stable number AFTER success. An
// interrupted POST must never turn into an orphan merely because a ref moved.
export async function writeSubmissionAssociation(env: Env, association: Association, etag?: string): Promise<string> {
  const result = await env.BUCKET.put(associationKey(association.submission_id), JSON.stringify({
    schema: 1, repository: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`, ...association,
  }), {httpMetadata: {contentType: 'application/json', cacheControl: 'no-store'},
    onlyIf: etag ? {etagMatches: etag} : {etagDoesNotMatch: '*'}});
  if (!result) throw new Error('submission_association_conflict');
  return result.etag;
}
export class GitHubError extends Error {
  constructor(public status: number, public uncertain = false) {
    super(`github_http_${status}`);
  }
}

// A per-invocation budget bounds cleanup, including pagination. No response body,
// authorization header, student metadata, or upstream error text is logged.
export class GitHub {
  calls = 0;
  constructor(public env: Env, private budget = 32) {}
  get root() { return `/repos/${encodeURIComponent(this.env.GITHUB_OWNER)}/${encodeURIComponent(this.env.GITHUB_REPO)}`; }
  async request<T = any>(method: string, path: string, body?: unknown, allow404 = false): Promise<T> {
    if (++this.calls > this.budget) throw new Error('github_budget_exhausted');
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${this.root}${path}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(15_000),
        headers: {Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'root-archive-worker/2',
          'Content-Type': 'application/json', 'Cache-Control': 'no-cache'},
        cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new GitHubError(0, true); }
    if (response.status === 404 && allow404) return null as T;
    if (!response.ok) throw new GitHubError(response.status, response.status >= 500);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch { throw new GitHubError(response.status, method !== 'GET'); }
  }
  async main(): Promise<string> {
    const ref = await this.request('GET', '/git/ref/heads/main');
    if (ref?.ref !== 'refs/heads/main' || !shaPattern.test(ref?.object?.sha)
      || ref.object.type !== 'commit') throw new Error('invalid_main_ref');
    return ref.object.sha;
  }
  async json(path: string, ref: string, optional = false): Promise<any> {
    if (!shaPattern.test(ref)) throw new Error('invalid_content_ref');
    const value = await this.request('GET', `/contents/${path}?ref=${ref}`, undefined, optional);
    if (value === null) return null;
    if (value?.type !== 'file' || value.encoding !== 'base64' || typeof value.content !== 'string'
      || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 4 * 1024 * 1024) throw new Error('invalid_github_content');
    try {
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(
        Uint8Array.from(atob(value.content.replace(/\s/g, '')), c => c.charCodeAt(0))));
    } catch { throw new Error('invalid_github_json'); }
  }
  async catalog(ref: string): Promise<any[]> {
    const catalog = await this.json('site/resources.json', ref);
    // Courses are also fetched at the authoritative commit: never use a cached
    // deployed catalog or compiled snapshot to authorize destructive cleanup.
    const courses = await this.json('site/courses.json', ref);
    validateCatalogs(courses, catalog);
    return catalog;
  }
  async branchPulls(branch: string): Promise<any[]> {
    const pulls = await this.request('GET', `/pulls?state=all&head=${encodeURIComponent(`${this.env.GITHUB_OWNER}:${branch}`)}&per_page=100`);
    if (!Array.isArray(pulls) || pulls.length >= 100) throw new Error('ambiguous_submission_prs');
    for (const pr of pulls) {
      if (!Number.isSafeInteger(pr.number) || pr.base?.ref !== 'main'
        || pr.head?.ref !== branch
        || pr.head?.repo?.full_name !== `${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}`) throw new Error('unexpected_submission_pr');
    }
    return pulls;
  }
  async submissionPull(id: string, objectKey: string): Promise<any | null> {
    const stored = await this.env.BUCKET.get(associationKey(id));
    if (!stored) throw new Error('submission_association_missing');
    const association = await stored.json();
    if (association?.schema !== 1 || association.repository !== `${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}`
      || association.submission_id !== id || association.object_key !== objectKey) throw new Error('invalid_submission_association');
    if (association.phase === 'linked') {
      const number = association.pr_number;
      if (!Number.isSafeInteger(number) || number <= 0) throw new Error('invalid_submission_association');
      // 404, outages and malformed responses are uncertainty, never absence.
      const pr = await this.request('GET', `/pulls/${number}`);
      if (pr?.number !== number) throw new Error('unexpected_pr_number');
      if (typeof pr.head?.ref !== 'string' || !pr.head.ref) throw new Error('untrusted_pr_state');
      // Preserve the multiple-PR guard; an empty mutable-ref lookup never
      // overrides the stable association or implies that this PR disappeared.
      if ((await this.branchPulls(pr.head.ref)).some(p => p.number !== number)) throw new Error('multiple_submission_prs');
      return pr;
    }
    if (association.phase !== 'not-created' || association.pr_number !== undefined) throw new Error('submission_creation_uncertain');
    // Absence of a branch match is only corroborating evidence. Orphan cleanup
    // also requires the durable proof that the Worker never created a PR.
    if ((await this.branchPulls(`submission/${id}`)).length) throw new Error('unexpected_unlinked_pr');
    return null;
  }
  async commitFiles(parent: string, files: {path: string; content: string}[], message: string): Promise<string> {
    const commit = await this.request('GET', `/git/commits/${parent}`);
    if (!shaPattern.test(commit?.tree?.sha)) throw new Error('invalid_base_tree');
    const tree = await this.request('POST', '/git/trees', {base_tree: commit.tree.sha,
      tree: files.map(f => ({...f, mode: '100644', type: 'blob'}))});
    if (!shaPattern.test(tree?.sha)) throw new Error('invalid_created_tree');
    const result = await this.request('POST', '/git/commits', {message, tree: tree.sha, parents: [parent]});
    if (!shaPattern.test(result?.sha)) throw new Error('invalid_created_commit');
    return result.sha;
  }
}
