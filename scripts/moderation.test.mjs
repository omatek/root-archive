import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { git, changesBetween, inspectSubmission } from './submission-git.mjs';
import { validateProposal, validateRecord } from './moderation-policy.mjs';
import { validatePullRequest } from './validate-submission.mjs';
import { reconcile } from './reconcile-submission.mjs';
import { config, courses, record, resource, id, secondId } from '../worker/tests/fixtures.mjs';
const changes = [{path: 'site/resources.json', status: 'M', mode: '100644'},
  {path: `submissions/${id}.json`, status: 'A', mode: '100644'}];
const proposal = (patch = {}) => ({courses, base: [], proposed: [resource()], record: record(), changes,
  assetBase: config.asset_base_url, ...patch});

test('exact single record/catalog addition passes, unknown fields and mismatched identity fail', () => {
  assert.equal(validateProposal(proposal()).id, id);
  for (const patch of [{schema: 2}, {unexpected: true}, {object_key: `assets/v1/${secondId}.pdf`}]) {
    assert.throws(() => validateRecord({...record(), ...patch}, courses, config.asset_base_url));
  }
  for (const patch of [{asset_url: 'https://attacker.invalid/evil.pdf'}, {asset_url: resource().asset_url + '?query=1'},
    {id: secondId}, {title: '<img onerror=alert(1)>'}, {title: '\u202emetadata'}, {contributor: 'line\nbreak'},
    {unexpected: true}]) assert.throws(() => validateRecord({...record(), resource: {...resource(), ...patch}}, courses, config.asset_base_url));
});
test('overwrite, removal, duplicate IDs/objects, order changes and record/catalog mismatches fail', () => {
  const older = resource(secondId);
  for (const proposed of [[resource()], [older, {...older, title: 'Impersonated resource'}],
    [{...older, title: 'Changed existing'}, resource()], [resource(), older], [older, older, resource()]]) {
    assert.throws(() => validateProposal(proposal({base: [older], proposed})));
  }
  assert.throws(() => validateProposal(proposal({record: {...record(), resource: {...resource(), title: 'Different title'}}})));
});
test('workflow, validator, Worker and arbitrary file changes, removals and symlinks fail', () => {
  for (const path of ['.github/workflows/ci.yml', 'scripts/moderation-policy.mjs', 'worker/worker.ts',
    '../outside', 'submissions/retired/test.json', 'site/courses.json']) {
    assert.throws(() => validateProposal(proposal({changes: [...changes, {path, status: 'M', mode: '100644'}]})));
  }
  for (const patch of [{status: 'D'}, {status: 'M'}, {mode: '120000'}, {mode: '100755'}]) {
    assert.throws(() => validateProposal(proposal({changes: [changes[0], {...changes[1], ...patch}]})));
  }
});

let repo;
function write(path, value) {
  mkdirSync(join(repo, path, '..'), {recursive: true});
  writeFileSync(join(repo, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
function commit(message) { git(repo, ['add', '.']); git(repo, ['commit', '-qm', message]); return git(repo, ['rev-parse', 'HEAD']); }
function pr(submissionId = id) { return {base: {ref: 'main', repo: {full_name: 'omatek/root-archive'}},
  head: {ref: `submission/${submissionId}`, repo: {full_name: 'omatek/root-archive'}},
  user: {login: config.submission_author}, labels: []}; }
function init() {
  repo = mkdtempSync(join(tmpdir(), 'archive-policy-'));
  git(repo, ['init', '-q', '-b', 'main']); git(repo, ['config', 'user.name', 'Synthetic']);
  git(repo, ['config', 'user.email', 'synthetic@example.invalid']);
  write('site/resources.json', []); write('site/courses.json', courses); write('moderation.config.json', config);
  return commit('base');
}
function submission(submissionId = id) {
  write('site/resources.json', [resource(submissionId)]); write(`submissions/${submissionId}.json`, record(submissionId));
  return commit('submission');
}

test('real Git diff authorizes a submission and rejects tampered validator without executing it', async () => {
  const base = init();
  try {
    git(repo, ['switch', '-qc', `submission/${id}`]); let head = submission();
    assert.match(await validatePullRequest({repo, base, head, pr: pr(), config, checkAsset: false}), /authorized/);
    const marker = join(repo, 'executed');
    write('scripts/validate-submission.mjs', `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe');`);
    head = commit('tamper with validator');
    await assert.rejects(validatePullRequest({repo, base, head, pr: pr(), config, checkAsset: false}));
    assert.equal(existsSync(marker), false);
  } finally { rmSync(repo, {recursive: true, force: true}); }
});
test('two conflicting proposals reconcile with latest main without losing either resource', async () => {
  const original = init();
  try {
    git(repo, ['switch', '-qc', `submission/${id}`]); const first = submission();
    git(repo, ['switch', '-qc', `submission/${secondId}`, original]); const second = submission(secondId);
    git(repo, ['switch', '-q', 'main']); git(repo, ['merge', '--ff-only', first]);
    // This old branch has a conflicting full JSON catalog and is not current.
    await assert.rejects(validatePullRequest({repo, base: first, head: second, pr: pr(secondId), config, checkAsset: false}));
    git(repo, ['switch', '-q', `submission/${secondId}`]);
    assert.throws(() => git(repo, ['merge-tree', '--write-tree', first, second]));
    const merged = reconcile(repo, first, second, config);
    assert.equal(inspectSubmission(repo, first, merged, config).resource.id, secondId);
    assert.match(await validatePullRequest({repo, base: first, head: merged, pr: pr(secondId), config, checkAsset: false}), /authorized/);
    const catalog = JSON.parse(git(repo, ['show', `${merged}:site/resources.json`]));
    assert.deepEqual(catalog.map(r => r.id), [id, secondId]);
    assert.throws(() => reconcile(repo, first, first, config));
    assert.ok(changesBetween(repo, first, merged).length === 2);
  } finally { rmSync(repo, {recursive: true, force: true}); }
});
test('legacy submission PR remains blocked, with a clear resubmission instruction', async () => {
  const base = init();
  try {
    write('submissions/old-test.json', resource()); const head = commit('legacy record only');
    await assert.rejects(validatePullRequest({repo, base, head, pr: {...pr(), head: {...pr().head, ref: 'submission-legacy'}}, config,
      checkAsset: false}), /legacy PRs must be closed and resubmitted/);
  } finally { rmSync(repo, {recursive: true, force: true}); }
});
test('forged Worker identity and arbitrary asset availability fail validation', async () => {
  const base = init(); const originalFetch = globalThis.fetch;
  try {
    const head = submission(); const forged = {...pr(), user: {login: 'untrusted'}};
    await assert.rejects(validatePullRequest({repo, base, head, pr: forged, config, checkAsset: false}), /configured Worker identity/);
    globalThis.fetch = async () => new Response(null, {status: 404});
    await assert.rejects(validatePullRequest({repo, base, head, pr: pr(), config}), /asset unavailable/);
  } finally { globalThis.fetch = originalFetch; rmSync(repo, {recursive: true, force: true}); }
});
test('engineering PRs use normal review; catalog maintenance requires verified write identity and preserves receipts', async () => {
  init(); write('site/resources.json', [resource()]); const base = commit('approved baseline');
  try {
    write('worker/change.ts', '// synthetic'); let head = commit('engineering change');
    const engineering = {...pr(), head: {...pr().head, ref: 'feature/engineering'}, user: {login: 'untrusted'}};
    assert.match(await validatePullRequest({repo, base, head, pr: engineering, config}), /Engineering PR/);
    git(repo, ['switch', '-qc', 'maintenance', base]);
    write('site/resources.json', []); head = commit('catalog maintenance');
    engineering.labels = [{name: 'catalog-maintenance'}];
    await assert.rejects(validatePullRequest({repo, base, head, pr: engineering, config, maintainer: false}));
    assert.match(await validatePullRequest({repo, base, head, pr: engineering, config, maintainer: true}), /maintainer catalog/);
    write(`submissions/${id}.json`, record()); head = commit('receipt mutation');
    await assert.rejects(validatePullRequest({repo, base, head, pr: engineering, config, maintainer: true}), /permanent/);
  } finally { rmSync(repo, {recursive: true, force: true}); }
});
test('trusted workflow always checks out base, never installs or executes head, and posts exact-head status', () => {
  const workflow = readFileSync(new URL('../.github/workflows/submission-policy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /ref:.*head|npm |secrets\./);
  assert.match(workflow, /statuses: write/);
});

test('trusted CLI fetches inert PR objects and posts pending/success/failure on exact head', () => {
  const base = init();
  const external = mkdtempSync(join(tmpdir(), 'archive-status-'));
  try {
    git(repo, ['switch', '-qc', `submission/${id}`]); const head = submission();
    git(repo, ['update-ref', 'refs/pull/17/head', head]); git(repo, ['remote', 'add', 'origin', repo]);
    git(repo, ['switch', '-q', 'main']);
    const event = {...pr(), number: 17, state: 'open'}; event.head.sha = head;
    const eventPath = join(external, 'event.json'); const statuses = join(external, 'statuses.jsonl');
    writeFileSync(eventPath, JSON.stringify({pull_request: event}));
    const mock = join(external, 'mock.mjs');
    writeFileSync(mock, `import {appendFileSync} from 'node:fs';
      globalThis.fetch = async (input, options = {}) => {
        const url = new URL(input);
        if (url.origin === ${JSON.stringify(config.asset_base_url)}) return new Response(null, {status:200});
        if (url.hostname !== 'api.github.com') throw new Error('offline fixture');
        if (options.method === 'POST') {
          appendFileSync(${JSON.stringify(statuses)}, JSON.stringify({path:url.pathname, ...JSON.parse(options.body)})+'\\n');
          return Response.json({});
        }
        if (url.pathname.endsWith('/pulls/17')) return Response.json(${JSON.stringify(event)});
        throw new Error('unexpected fixture request');
      };`);
    const runner = new URL('./validate-submission.mjs', import.meta.url).pathname;
    // git() supplies a controlled subprocess environment and captures output.
    const invoke = () => execFileSync(process.execPath, ['--import', mock, runner], {cwd: repo,
      env: {...process.env, GITHUB_TOKEN: 'synthetic', GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'omatek/root-archive', GITHUB_RUN_ID: '123'}, stdio: 'pipe'});
    invoke();
    let values = readFileSync(statuses, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(values.map(s => s.state), ['pending', 'success']);
    assert.ok(values.every(s => s.context === 'Submission policy' && s.path.endsWith(head)));
    assert.equal(git(repo, ['rev-parse', 'HEAD']), base);
    // Malicious code remains unexecuted and only base runner reports rejection.
    git(repo, ['switch', '-q', `submission/${id}`]);
    write('scripts/validate-submission.mjs', 'throw new Error("untrusted code executed");');
    const bad = commit('tampered validator');
    git(repo, ['update-ref', 'refs/pull/17/head', bad]); git(repo, ['switch', '-q', 'main']);
    event.head.sha = bad; writeFileSync(eventPath, JSON.stringify({pull_request: event}));
    assert.throws(invoke);
    values = readFileSync(statuses, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(values.slice(-2).map(s => s.state), ['pending', 'failure']);
    assert.ok(values.slice(-2).every(s => s.path.endsWith(bad)));
    assert.equal(git(repo, ['rev-parse', 'HEAD']), base);
  } finally { rmSync(repo, {recursive: true, force: true}); rmSync(external, {recursive: true, force: true}); }
});
