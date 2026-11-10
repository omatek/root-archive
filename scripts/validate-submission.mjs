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

async function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  const head = sha(pr.head.sha);
  const repoName = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoName) || !Number.isSafeInteger(pr.number)) throw new Error('Invalid event');
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com/repos/${repoName}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return response.json();
  };
  const status = (state, description) => api(`/statuses/${head}`, 'POST', {state,
    context: 'Submission policy', description,
    target_url: `https://github.com/${repoName}/actions/runs/${process.env.GITHUB_RUN_ID}`});
  await status('pending', 'Validating with protected-base code');
  try {
    const base = sha(git('.', ['rev-parse', 'HEAD']));
    git('.', ['fetch', '--no-tags', 'origin', `refs/pull/${pr.number}/head`]);
    if (sha(git('.', ['rev-parse', 'FETCH_HEAD'])) !== head) throw new Error('PR changed; retry latest event');
    const config = readJson('.', base, 'moderation.config.json');
    let maintainer = false;
    if (!pr.head.ref.startsWith('submission') && pr.labels.some(l => l.name === 'catalog-maintenance')) {
      const result = await api(`/collaborators/${encodeURIComponent(pr.user.login)}/permission`);
      maintainer = ['admin', 'maintain', 'write'].includes(result.permission);
    }
    const result = await validatePullRequest({repo: '.', base, head, pr, config, maintainer});
    const current = await api(`/pulls/${pr.number}`);
    if (current.head.sha !== head || current.state !== 'open') throw new Error('PR no longer open at validated head');
    await status('success', result.slice(0, 140));
    console.log(result);
  } catch (error) {
    await status('failure', 'Publication policy rejected this proposal; inspect trusted job logs');
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) run().catch(error => {
  // Policy messages are fixed strings; never print submission content.
  console.error(error.message);
  process.exitCode = 1;
});
