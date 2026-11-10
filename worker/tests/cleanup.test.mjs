import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../.wrangler/dist/worker.js';
import { GitHubMock, MemoryBucket, envFor, id, secondId, key, day, hour, record, resource } from './fixtures.mjs';
let github, bucket, env;
const original = globalThis.fetch;
const run = () => worker.scheduled({}, env);
test.beforeEach(async () => { github = new GitHubMock(); bucket = new MemoryBucket(); env = envFor(bucket);
  await bucket.seed(); globalThis.fetch = github.fetch.bind(github); });
test.after(() => { globalThis.fetch = original; });

test('closed unmerged rejection retires old valid head then deletes after grace', async () => {
  const pr = github.closed(); const previous = pr.head.sha;
  await run(); assert.deepEqual(bucket.deleted, [key]); assert.notEqual(pr.head.sha, previous);
  const files = github.trees.get(github.commits.get(pr.head.sha).tree.sha);
  assert.deepEqual(files[`submissions/retired/${id}.json`], {id, retired: true});
});
test('recent rejection and young orphan retain their grace periods', async () => {
  const pr = github.closed(hour);
  await run(); assert.equal(bucket.deleted.length, 0);
  github.prs = []; bucket.values.get(key).uploaded = new Date();
  bucket.values.get(key).customMetadata.created_at = new Date().toISOString();
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('confirmed seven-day orphan is removed; no PR is opened', async () => {
  await run(); assert.deepEqual(bucket.deleted, [key]); assert.equal(github.prs.length, 0);
});
test('approved catalog, permanent receipt and merged PR each independently protect objects', async () => {
  github.closed(); github.setCatalog([resource()]);
  await run(); assert.equal(bucket.deleted.length, 0);
  github.setCatalog([], record()); await run(); assert.equal(bucket.deleted.length, 0);
  github.setCatalog([]); github.prs[0].merged = true; github.prs[0].merged_at = new Date().toISOString();
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('GitHub outage, rate limiting, malformed catalog and missing catalog all fail closed', async () => {
  for (const status of [403, 429, 500, 404, 'network']) {
    github.fail = path => path.startsWith('/contents/site/resources.json') ? status : 0;
    await run(); assert.equal(bucket.deleted.length, 0);
  }
  github.fail = undefined; github.setCatalog({malformed: true});
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('delete failure is retried and branch retirement is idempotent', async () => {
  const pr = github.closed(); bucket.failDelete = true;
  await run(); assert.equal(bucket.deleted.length, 0); const retired = pr.head.sha;
  bucket.failDelete = false; await run(); assert.deepEqual(bucket.deleted, [key]);
  assert.equal(pr.head.sha, retired);
});
test('old PR with recent comments, review or inline activity is retained', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`);
  for (const type of ['comments', 'reviews', 'inline']) {
    github[type] = [{id: 1, state: 'APPROVED', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString()}];
    await run(); assert.equal(pr.state, 'open'); github[type] = [];
  }
  pr.updated_at = new Date().toISOString(); await run(); assert.equal(pr.state, 'open');
  assert.equal(bucket.deleted.length, 0);
});
test('genuinely inactive PR is commented, closed and verified without immediate deletion', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`);
  await run(); assert.equal(github.comments.length, 1); assert.equal(pr.state, 'closed');
  assert.equal(bucket.deleted.length, 0);
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('new activity while expiration is being explained cancels closure', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`);
  github.before = (path, method) => {
    if (method === 'POST' && path.startsWith('/issues/')) github.comments.push({id: 7, updated_at: new Date().toISOString()});
  };
  await run(); assert.equal(pr.state, 'open'); assert.equal(bucket.deleted.length, 0);
});
test('dry-run logs decisions and off mode performs no storage or GitHub work', async () => {
  github.closed(); env.CLEANUP_MODE = 'dry-run';
  await run(); assert.equal(bucket.deleted.length, 0);
  assert.equal(github.requests.some(r => r.method !== 'GET'), false);
  env.CLEANUP_MODE = 'off'; github.requests = []; await run(); assert.equal(github.requests.length, 0);
});
test('legacy and malformed provenance objects are retained without using student-controlled keys', async () => {
  bucket.values.get(key).customMetadata = {};
  await run(); assert.equal(bucket.deleted.length, 0); assert.equal(github.requests.length, 0);
  await bucket.put('assets/legacy/test.pdf', 'synthetic'); await run();
  assert.equal(bucket.deleted.length, 0);
});
test('bounded cursor reaches later keys despite repeated first-key failures, wraps and retries', async () => {
  await bucket.seed(secondId); github.closed(); github.setCatalog([resource(id)]);
  // Approved first key remains. Next invocation must reach and remove orphan 2.
  await run(); assert.equal(bucket.deleted.length, 0);
  await run(); assert.deepEqual(bucket.deleted, [`assets/v1/${secondId}.pdf`]);
  await run(); assert.ok(bucket.values.has(key));
  // Transient failure on first key must also advance, then retry on next sweep.
  await bucket.seed(secondId); github.setCatalog([]); bucket.failDelete = true;
  await run(); bucket.failDelete = false; await run(); await run();
  assert.equal(bucket.values.has(key), false); assert.equal(bucket.values.has(`assets/v1/${secondId}.pdf`), false);
});
test('overlapping scans are idempotent and use compare-and-swap cursor progress', async () => {
  await Promise.all([run(), run()]); assert.equal(bucket.values.has(key), false);
  const cursor = await bucket.get('moderation-control/scan-v1.json'); assert.equal((await cursor.json()).schema, 1);
});
test('merge racing retirement is retained after fresh authoritative publication check', async () => {
  const pr = github.closed();
  github.before = (path, method) => {
    if (method === 'PATCH' && path.startsWith('/git/refs/heads/')) {
      github.setCatalog([resource()], record()); pr.merged = true; pr.merged_at = new Date().toISOString();
    }
  };
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('publication that appears after branch retirement is retained even when the earlier catalog was empty', async () => {
  github.closed(); let reads = 0;
  github.before = path => { if (path === '/git/ref/heads/main' && ++reads === 2) github.setCatalog([resource()], record()); };
  await run(); assert.equal(bucket.deleted.length, 0); assert.equal(reads, 2);
});
test('reopening or new PR creation during retirement cancels deletion', async () => {
  const pr = github.closed();
  github.before = (path, method) => { if (method === 'PATCH' && path.startsWith('/git/refs/heads/')) pr.state = 'open'; };
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('changed objects and unexpected repository state are retained', async () => {
  github.closed(); let mainReads = 0;
  github.before = path => { if (path === '/git/ref/heads/main' && ++mainReads === 2) bucket.values.get(key).etag = 'changed'; };
  await run(); assert.equal(bucket.deleted.length, 0);
  github.prs[0].user.login = 'untrusted'; github.before = undefined;
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('activity pagination exceeding the bounded budget retains the object', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`);
  github.reviews = Array.from({length: 100}, () => ({state: 'APPROVED', submitted_at: pr.created_at}));
  await run(); assert.equal(pr.state, 'open'); assert.equal(bucket.deleted.length, 0);
});

test('expiration comment is reused after close failure and does not reset inactivity for 30 days', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`);
  github.fail = (path, method) => method === 'PATCH' && /^\/pulls\/\d+$/.test(path) ? 503 : 0;
  await run(); assert.equal(pr.state, 'open'); assert.equal(github.comments.length, 1);
  github.fail = undefined; await run(); assert.equal(pr.state, 'closed'); assert.equal(github.comments.length, 1);
  assert.equal(bucket.deleted.length, 0);
});

test('deleted rejected branch is restored only at an invalid terminal head before deletion', async () => {
  const pr = github.closed(); github.refs.delete(`submission/${id}`);
  await run(); assert.deepEqual(bucket.deleted, [key]);
  const head = github.refs.get(`submission/${id}`);
  assert.notEqual(head, pr.head.sha);
  assert.ok(github.trees.get(github.commits.get(head).tree.sha)[`submissions/retired/${id}.json`]);
});
test('overlapping retirement of a rejected branch rejects divergent non-force ref updates safely', async () => {
  github.closed(); await bucket.seed(secondId);
  await Promise.all([run(), run()]); await run();
  assert.equal(bucket.values.has(key), false);
  assert.equal(bucket.values.has(`assets/v1/${secondId}.pdf`), false);
  assert.ok(github.requests.every(r => r.body?.force !== true));
});

test('authoritative catalog URL aliases also preserve the referenced R2 object', async () => {
  github.closed();
  for (const asset_url of [resource().asset_url + '?download=1', resource().asset_url + '#page=2',
    resource().asset_url.replace('/v1/', '/v%31/')]) {
    github.setCatalog([{...resource(), id: 'legacy-display-id', asset_url}]);
    await run(); assert.equal(bucket.deleted.length, 0);
  }
});
