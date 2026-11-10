import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../.wrangler/dist/worker.js';
import { GitHubMock, MemoryBucket, envFor, id, secondId, key, day, hour, record, resource, associate, associationKey } from './fixtures.mjs';
let github, bucket, env;
const original = globalThis.fetch;
const run = () => worker.scheduled({}, env);
const link = pr => associate(bucket, id, 'linked', pr.number);
test.beforeEach(async () => { github = new GitHubMock(); bucket = new MemoryBucket(); env = envFor(bucket);
  await bucket.seed(); globalThis.fetch = github.fetch.bind(github); });
test.after(() => { globalThis.fetch = original; });

test('a PR in any state/age is a hold and cleanup never mutates GitHub', async () => {
  const pr = github.closed(); await link(pr);
  for (const state of ['open', 'closed']) {
    pr.state = state; pr.created_at = new Date(Date.now() - 60 * day).toISOString();
    pr.closed_at = new Date(Date.now() - 40 * day).toISOString();
    await run(); assert.ok(await bucket.head(key));
  }
  assert.equal(github.requests.some(r => r.method !== 'GET'), false);
});
test('proven never-created orphan is deleted only after seven days', async () => {
  await run(); assert.deepEqual(bucket.deleted, [key]); assert.equal(github.prs.length, 0);
  assert.equal(github.requests.some(r => r.method !== 'GET'), false);
});
test('young never-created orphan is retained', async () => {
  await bucket.seed(id, 7 * day - hour); await run(); assert.ok(await bucket.head(key));
});
test('a remaining or reused orphan branch is retained without any branch mutation', async () => {
  github.refs.set(`submission/${id}`, github.main);
  await run(); assert.ok(await bucket.head(key));
  assert.equal(github.refs.get(`submission/${id}`), github.main);
  assert.equal(github.requests.some(r => r.method !== 'GET'), false);
});
test('approved catalog, permanent receipt and merged PR each independently retain objects', async () => {
  const pr = github.closed(); await link(pr); github.setCatalog([resource()]);
  await run(); assert.ok(await bucket.head(key));
  github.setCatalog([], record()); await run(); assert.ok(await bucket.head(key));
  github.setCatalog([]); pr.merged = true; pr.merged_at = new Date().toISOString();
  await run(); assert.ok(await bucket.head(key));
});
test('publication verification outages and malformed catalog fail closed', async () => {
  for (const status of [403, 429, 500, 404, 'network']) {
    github.fail = path => path.startsWith('/contents/site/resources.json') ? status : 0;
    await run(); assert.ok(await bucket.head(key));
  }
  github.fail = undefined; github.setCatalog({malformed: true}); await run(); assert.ok(await bucket.head(key));
});
test('linked PR verification failures, including 404, never establish orphanhood', async () => {
  const pr = github.closed(); await link(pr); github.refs.delete(pr.head.ref);
  for (const status of [404, 403, 429, 503, 'network']) {
    github.fail = path => path === `/pulls/${pr.number}` ? status : 0;
    await run(); assert.ok(await bucket.head(key));
  }
});
test('missing, malformed and interrupted associations retain old uploads', async () => {
  const saved = await (await bucket.get(associationKey(id))).json();
  for (const value of [null, '{invalid', {...saved, schema: 2}, {...saved, submission_id: secondId},
    {...saved, repository: 'other/repo'}, {...saved, object_key: 'assets/other.pdf'},
    {...saved, phase: 'creating'}, {...saved, phase: 'linked', pr_number: -1}, {...saved, pr_number: 1}]) {
    if (value === null) bucket.values.delete(associationKey(id));
    else await bucket.put(associationKey(id), typeof value === 'string' ? value : JSON.stringify(value));
    await run(); assert.ok(await bucket.head(key));
  }
});
test('unexpected or multiple PRs retain the object', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`);
  await run(); assert.ok(await bucket.head(key));
  await link(pr); github.makePR(pr.head.ref); await run(); assert.ok(await bucket.head(key));
});
test('R2 delete failure retries on a later sweep', async () => {
  bucket.failDelete = true; await run(); assert.ok(await bucket.head(key));
  bucket.failDelete = false; await run(); assert.equal(await bucket.head(key), null);
});
test('cursor reaches later keys despite a retained first key, then wraps', async () => {
  await bucket.seed(secondId); await link(github.closed());
  await run(); assert.equal(bucket.deleted.length, 0);
  await run(); assert.deepEqual(bucket.deleted, [`assets/v1/${secondId}.pdf`]);
  await run(); assert.ok(await bucket.head(key));
});
test('overlapping orphan scans are idempotent with conditional cursor progress', async () => {
  await Promise.all([run(), run()]); assert.equal(await bucket.head(key), null);
  assert.equal((await (await bucket.get('moderation-control/scan-v1.json')).json()).schema, 1);
});
test('a publication appearing during orphan verification is retained', async () => {
  let reads = 0;
  github.before = path => {if (path === '/git/ref/heads/main' && ++reads === 2) github.setCatalog([resource()], record());};
  await run(); assert.ok(await bucket.head(key)); assert.equal(reads, 2);
});
test('new association or branch during orphan verification cancels deletion', async () => {
  let reads = 0;
  github.before = async path => {
    if (path === `/git/ref/heads/submission/${id}` && ++reads === 1) await associate(bucket, id, 'creating');
  };
  await run(); assert.ok(await bucket.head(key));
  await associate(bucket); github.before = path => {
    if (path === `/git/ref/heads/submission/${id}`) github.refs.set(`submission/${id}`, github.main);
  };
  await run(); assert.ok(await bucket.head(key));
});
test('changed storage identity cancels deletion', async () => {
  let reads = 0;
  github.before = path => {if (path === '/git/ref/heads/main' && ++reads === 2) bucket.values.get(key).etag = 'changed';};
  await run(); assert.ok(await bucket.head(key));
});
test('dry run is read-only and off mode makes no upstream calls', async () => {
  env.CLEANUP_MODE = 'dry-run'; await run(); assert.ok(await bucket.head(key));
  assert.equal(github.requests.some(r => r.method !== 'GET'), false);
  env.CLEANUP_MODE = 'off'; github.requests = []; await run(); assert.equal(github.requests.length, 0);
});
test('missing/legacy provenance is retained without GitHub verification', async () => {
  bucket.values.get(key).customMetadata = {}; await run();
  assert.ok(await bucket.head(key)); assert.equal(github.requests.length, 0);
});
test('approved URL aliases protect managed objects independently of association', async () => {
  for (const asset_url of [resource().asset_url + '?download=1', resource().asset_url.replace('/v1/', '/v%31/')]) {
    github.setCatalog([{...resource(), id: 'legacy-id', asset_url}]); await run(); assert.ok(await bucket.head(key));
  }
});
test('security regression: automatic closure on head rename never authorizes deletion at either grace boundary', async () => {
  const pr = github.closed(); await link(pr);
  github.refs.set('review/rename-auto-closed', pr.head.sha); github.refs.delete(pr.head.ref);
  pr.head.ref = 'review/rename-auto-closed';
  // GitHub closes a head PR on rename; it need not have been rejected.
  for (const age of [12 * hour - 1000, 12 * hour, 7 * day, 8 * day]) {
    pr.closed_at = new Date(Date.now() - age).toISOString();
    await run();
    assert.ok(await bucket.head(key), `rename-closed object must survive age ${age}`);
  }
  assert.equal(github.requests.some(r => r.method !== 'GET'), false);
});
test('security regression: a reused submission branch must never be modified by cleanup', async () => {
  const pr = github.closed(); await link(pr);
  // The PR keeps its old head snapshot while its former name is reused.
  const reused = await github.fetch(`https://api.github.com/repos/omatek/root-archive/git/trees`, {
    method: 'POST', body: JSON.stringify({base_tree: github.commits.get(github.main).tree.sha,
      tree: [{path: 'unrelated.json', content: '{"unrelated":true}'}]})});
  const tree = (await reused.json()).sha;
  const commit = await github.fetch('https://api.github.com/repos/omatek/root-archive/git/commits', {
    method: 'POST', body: JSON.stringify({tree, parents: [github.main], message: 'unrelated feature'})});
  const unrelated = (await commit.json()).sha;
  github.refs.set(pr.head.ref, unrelated); github.requests = [];
  await run();
  assert.equal(github.refs.get(pr.head.ref), unrelated);
  assert.equal(github.requests.some(r => r.method !== 'GET'), false);
  assert.ok(await bucket.head(key));
});
