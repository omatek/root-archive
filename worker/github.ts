import type { Env } from './worker';
import { validateCatalogs } from '../scripts/catalog-policy.mjs';

export const shaPattern = /^[0-9a-f]{40}$/;
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
  async branchPulls(id: string): Promise<any[]> {
    const pulls = await this.request('GET', `/pulls?state=all&head=${encodeURIComponent(`${this.env.GITHUB_OWNER}:submission/${id}`)}&per_page=100`);
    if (!Array.isArray(pulls) || pulls.length >= 100) throw new Error('ambiguous_submission_prs');
    for (const pr of pulls) {
      if (!Number.isSafeInteger(pr.number) || pr.base?.ref !== 'main'
        || pr.head?.ref !== `submission/${id}`
        || pr.head?.repo?.full_name !== `${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}`) throw new Error('unexpected_submission_pr');
    }
    return pulls;
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
