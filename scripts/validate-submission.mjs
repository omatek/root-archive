// Execute only the protected-base copy. PR objects are read as data with git
// show/diff-tree; no head checkout, install, import, hooks or scripts execute.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { git, sha, readJson, changesBetween, inspectSubmission } from './submission-git.mjs';
import { validateCatalogs } from './catalog-policy.mjs';

export async function validatePullRequest({repo, base, head, pr, config, maintainer = false, checkAsset = true}) {
  sha(base); sha(head);
  if (pr.base.ref !== 'main') throw new Error('Expected protected main');
  git(repo, ['merge-base', '--is-ancestor', base, head]);
  const changes = changesBetween(repo, base, head);
  const submission = pr.head.ref.startsWith('submission/') || pr.head.ref.startsWith('submission-');
  const sensitive = changes.some(c => c.path === 'site/resources.json' || c.path.startsWith('submissions/'));
  if (!submission && !sensitive) return 'Engineering PR: normal maintainer review required';
  if (!submission && maintainer && pr.labels.some(l => l.name === 'catalog-maintenance')) {
    // The exception only removes published entries, retaining approval receipts.
    if (changes.some(c => c.path.startsWith('submissions/'))) throw new Error('Approval receipts are permanent');
    if (changes.length !== 1 || changes[0].path !== 'site/resources.json'
      || changes[0].status !== 'M' || changes[0].mode !== '100644') throw new Error('Maintenance may only remove catalog entries');
    const before = readJson(repo, base, 'site/resources.json');
    const after = readJson(repo, head, 'site/resources.json');
    validateCatalogs(readJson(repo, base, 'site/courses.json'), after);
    let offset = 0;
    for (const r of after) {
      while (offset < before.length && !isDeepStrictEqual(before[offset], r)) offset++;
      if (offset++ === before.length) throw new Error('Maintenance cannot add or change resources');
    }
    return 'Explicit maintainer catalog removal';
  }
  if (pr.user.login !== config.submission_author || pr.head.repo.full_name !== pr.base.repo.full_name) {
    throw new Error('Submission must originate from the configured Worker identity and repository');
  }
  const {resource} = inspectSubmission(repo, base, head, config);
  if (pr.head.ref !== `submission/${resource.id}`) throw new Error('Unexpected submission branch; legacy PR must be resubmitted');
  if (checkAsset) {
    const response = await fetch(resource.asset_url, {method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Managed asset unavailable; retain and retry or resubmit');
  }
  return 'One authorized catalog addition; maintainer review required';
}

function authorizationSnapshot(pr) {
  return JSON.stringify({state: pr.state, author: pr.user?.login,
    labels: pr.labels?.map(l => l.name).sort(),
    head: [pr.head?.sha, pr.head?.ref, pr.head?.repo?.full_name],
    base: [pr.base?.sha, pr.base?.ref, pr.base?.repo?.full_name]});
}
async function run() {
  // Event data identifies the requested PR/head only. It never grants access.
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const number = event.pull_request?.number;
  const head = sha(event.pull_request?.head?.sha);
  const repoName = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoName) || !Number.isSafeInteger(number)) throw new Error('Invalid event');
  const appId = Number(process.env.PUBLICATION_APP_ID);
  const appToken = process.env.PUBLICATION_CHECK_TOKEN;
  if (!appToken || !Number.isSafeInteger(appId) || appId <= 0 || appId === 15368) {
    throw new Error('A distinct publication GitHub App must be configured; no Actions-token fallback');
  }
  const api = async (path, method = 'GET', body, token = process.env.GITHUB_TOKEN) => {
    const response = await fetch(`https://api.github.com/repos/${repoName}${path}`, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return response.json();
  };
  const check = await api('/check-runs', 'POST', {name: 'Submission policy', head_sha: head,
    status: 'in_progress', details_url: `https://github.com/${repoName}/actions/runs/${process.env.GITHUB_RUN_ID}`}, appToken);
  if (!Number.isSafeInteger(check?.id) || check.id <= 0 || check.app?.id !== appId) {
    throw new Error('Publication check was not created by the configured App');
  }
  const finish = (conclusion, summary) => api(`/check-runs/${check.id}`, 'PATCH', {status: 'completed', conclusion,
    completed_at: new Date().toISOString(),
    output: {title: 'Publication policy', summary}}, appToken);
  try {
    const base = sha(git('.', ['rev-parse', 'HEAD']));
    git('.', ['fetch', '--no-tags', 'origin', `refs/pull/${number}/head`]);
    if (sha(git('.', ['rev-parse', 'FETCH_HEAD'])) !== head) throw new Error('PR changed; retry latest event');
    const config = readJson('.', base, 'moderation.config.json');
    const current = async () => {
      const pr = await api(`/pulls/${number}`);
      if (pr.number !== number || pr.head?.sha !== head || pr.state !== 'open'
        || pr.base?.sha !== base || pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== repoName
        || typeof pr.user?.login !== 'string' || !Array.isArray(pr.labels)) throw new Error('PR no longer matches the protected base and inspected head');
      return pr;
    };
    const isMaintainer = async pr => {
      if (pr.head.ref.startsWith('submission') || !pr.labels.some(l => l.name === 'catalog-maintenance')) return false;
      const permission = await api(`/collaborators/${encodeURIComponent(pr.user.login)}/permission`);
      return ['admin', 'maintain', 'write'].includes(permission.permission);
    };
    const initial = await current();
    const result = await validatePullRequest({repo: '.', base, head, pr: initial, config, maintainer: await isMaintainer(initial)});
    // Re-read every authorization input, including current writer permissions.
    // Old event labels and a past workflow run cannot restore removed authority.
    const final = await current();
    if (authorizationSnapshot(initial) !== authorizationSnapshot(final)) throw new Error('PR authorization changed during validation');
    await validatePullRequest({repo: '.', base, head, pr: final, config,
      maintainer: await isMaintainer(final), checkAsset: false});
    await finish('success', result);
    console.log(result);
  } catch (error) {
    await finish('failure', 'Publication policy rejected this proposal; inspect trusted job logs');
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch(error => {
  // Policy messages are fixed strings; never print submission content.
  console.error(error.message);
  process.exitCode = 1;
});
