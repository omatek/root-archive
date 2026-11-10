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

test('closed unmerged rejection retires old valid head then deletes after grace', async () => {
  const pr = github.closed(); await link(pr); const previous = pr.head.sha;
  await run(); assert.deepEqual(bucket.deleted, [key]); assert.notEqual(pr.head.sha, previous);
  const files = github.trees.get(github.commits.get(pr.head.sha).tree.sha);
  assert.deepEqual(files[`submissions/retired/${id}.json`], {id, retired: true});
});
test('recent rejection and young orphan retain their grace periods', async () => {
  const pr = github.closed(hour); await link(pr);
  await run(); assert.equal(bucket.deleted.length, 0);
  github.prs = []; await associate(bucket); bucket.values.get(key).uploaded = new Date();
  bucket.values.get(key).customMetadata.created_at = new Date().toISOString();
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('confirmed seven-day orphan is removed; no PR is opened', async () => {
  await run(); assert.deepEqual(bucket.deleted, [key]); assert.equal(github.prs.length, 0);
});
test('approved catalog, permanent receipt and merged PR each independently protect objects', async () => {
  await link(github.closed()); github.setCatalog([resource()]);
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
  const pr = github.closed(); await link(pr); bucket.failDelete = true;
  await run(); assert.equal(bucket.deleted.length, 0); const retired = pr.head.sha;
  bucket.failDelete = false; await run(); assert.deepEqual(bucket.deleted, [key]);
  assert.equal(pr.head.sha, retired);
});
test('old PR with recent comments, review or inline activity is retained', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`); await link(pr);
  for (const type of ['comments', 'reviews', 'inline']) {
    github[type] = [{id: 1, state: 'APPROVED', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString()}];
    await run(); assert.equal(pr.state, 'open'); github[type] = [];
  }
  pr.updated_at = new Date().toISOString(); await run(); assert.equal(pr.state, 'open');
  assert.equal(bucket.deleted.length, 0);
});
test('genuinely inactive PR is commented, closed and verified without immediate deletion', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`); await link(pr);
  await run(); assert.equal(github.comments.length, 1); assert.equal(pr.state, 'closed');
  assert.equal(bucket.deleted.length, 0);
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('new activity while expiration is being explained cancels closure', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`); await link(pr);
  github.before = (path, method) => {
    if (method === 'POST' && path.startsWith('/issues/')) github.comments.push({id: 7, updated_at: new Date().toISOString()});
  };
  await run(); assert.equal(pr.state, 'open'); assert.equal(bucket.deleted.length, 0);
});
test('dry-run logs decisions and off mode performs no storage or GitHub work', async () => {
  await link(github.closed()); env.CLEANUP_MODE = 'dry-run';
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
  await bucket.seed(secondId); await link(github.closed()); github.setCatalog([resource(id)]);
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
  const pr = github.closed(); await link(pr);
  github.before = (path, method) => {
    if (method === 'PATCH' && path.startsWith('/git/refs/heads/')) {
      github.setCatalog([resource()], record()); pr.merged = true; pr.merged_at = new Date().toISOString();
    }
  };
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('publication that appears after branch retirement is retained even when the earlier catalog was empty', async () => {
  await link(github.closed()); let reads = 0;
  github.before = path => { if (path === '/git/ref/heads/main' && ++reads === 2) github.setCatalog([resource()], record()); };
  await run(); assert.equal(bucket.deleted.length, 0); assert.equal(reads, 2);
});
test('reopening or new PR creation during retirement cancels deletion', async () => {
  const pr = github.closed(); await link(pr);
  github.before = (path, method) => { if (method === 'PATCH' && path.startsWith('/git/refs/heads/')) pr.state = 'open'; };
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('changed objects and unexpected repository state are retained', async () => {
  await link(github.closed()); let mainReads = 0;
  github.before = path => { if (path === '/git/ref/heads/main' && ++mainReads === 2) bucket.values.get(key).etag = 'changed'; };
  await run(); assert.equal(bucket.deleted.length, 0);
  github.prs[0].user.login = 'untrusted'; github.before = undefined;
  await run(); assert.equal(bucket.deleted.length, 0);
});
test('activity pagination exceeding the bounded budget retains the object', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`); await link(pr);
  github.reviews = Array.from({length: 100}, () => ({state: 'APPROVED', submitted_at: pr.created_at}));
  await run(); assert.equal(pr.state, 'open'); assert.equal(bucket.deleted.length, 0);
});

test('expiration comment is reused after close failure and does not reset inactivity for 30 days', async () => {
  github.refs.set(`submission/${id}`, github.main); const pr = github.makePR(`submission/${id}`); await link(pr);
  github.fail = (path, method) => method === 'PATCH' && /^\/pulls\/\d+$/.test(path) ? 503 : 0;
  await run(); assert.equal(pr.state, 'open'); assert.equal(github.comments.length, 1);
  github.fail = undefined; await run(); assert.equal(pr.state, 'closed'); assert.equal(github.comments.length, 1);
  assert.equal(bucket.deleted.length, 0);
});

test('deleted rejected branch is restored only at an invalid terminal head before deletion', async () => {
  const pr = github.closed(); await link(pr); github.refs.delete(`submission/${id}`);
  await run(); assert.deepEqual(bucket.deleted, [key]);
  const head = github.refs.get(`submission/${id}`);
  assert.notEqual(head, pr.head.sha);
  assert.ok(github.trees.get(github.commits.get(head).tree.sha)[`submissions/retired/${id}.json`]);
});
test('overlapping retirement of a rejected branch rejects divergent non-force ref updates safely', async () => {
  await link(github.closed()); await bucket.seed(secondId);
  await Promise.all([run(), run()]); await run();
  assert.equal(bucket.values.has(key), false);
  assert.equal(bucket.values.has(`assets/v1/${secondId}.pdf`), false);
  assert.ok(github.requests.every(r => r.body?.force !== true));
});

test('authoritative catalog URL aliases also preserve the referenced R2 object', async () => {
  await link(github.closed());
  for (const asset_url of [resource().asset_url + '?download=1', resource().asset_url + '#page=2',
    resource().asset_url.replace('/v1/', '/v%31/')]) {
    github.setCatalog([{...resource(), id: 'legacy-display-id', asset_url}]);
    await run(); assert.equal(bucket.deleted.length, 0);
  }
});

test('renamed active submission is found by its stable PR number, never treated as an orphan', async () => {
  const originalBranch = `submission/${id}`;
  github.refs.set(originalBranch, github.main);
  const pr = github.makePR(originalBranch);
  // The association survives changes to the branch name and PR presentation.
  await bucket.put(`moderation-control/submissions/${id}.json`, JSON.stringify({
    schema: 1, repository: 'omatek/root-archive', submission_id: id, object_key: key, phase: 'linked', pr_number: pr.number,
  }));
  github.refs.set('review/renamed-material', github.refs.get(originalBranch));
  github.refs.delete(originalBranch);
  pr.head.ref = 'review/renamed-material';
  pr.updated_at = new Date().toISOString();
  await run();
  assert.ok(await bucket.head(key), 'active submission object must survive a branch rename');
  assert.ok(github.requests.some(r => r.path === `/pulls/${pr.number}`));
  assert.equal(bucket.deleted.length, 0);
});

test('deleted active branch still retains its object through the persisted PR number', async () => {
  github.refs.set(`submission/${id}`, github.main);
  const pr = github.makePR(`submission/${id}`); await link(pr);
  pr.updated_at = new Date().toISOString();
  github.refs.delete(pr.head.ref);
  await run();
  assert.ok(await bucket.head(key));
  assert.equal(pr.state, 'open');
  assert.ok(github.requests.some(r => r.path === `/pulls/${pr.number}`));
});
test('renamed rejected branch is retired at its current name before eligible cleanup', async () => {
  const pr = github.closed(); await link(pr);
  const original = pr.head.ref;
  const renamed = 'review/renamed-rejection';
  github.refs.set(renamed, github.refs.get(original)); github.refs.delete(original); pr.head.ref = renamed;
  await run();
  assert.deepEqual(bucket.deleted, [key]);
  assert.equal(github.refs.has(original), false);
  assert.ok(github.requests.some(r => r.method === 'PATCH' && r.path === `/git/refs/heads/${renamed}`));
});
test('missing, malformed and ambiguous associations retain even old unreferenced objects', async () => {
  const saved = JSON.parse((await bucket.get(associationKey(id))).value);
  for (const value of [null, '{invalid', {...saved, schema: 2}, {...saved, submission_id: secondId},
    {...saved, repository: 'other/repo'}, {...saved, object_key: 'assets/other.pdf'},
    {...saved, phase: 'creating'}, {...saved, phase: 'linked', pr_number: -1},
    {...saved, phase: 'linked'}, {...saved, pr_number: 1}]) {
    if (value === null) bucket.values.delete(associationKey(id));
    else await bucket.put(associationKey(id), typeof value === 'string' ? value : JSON.stringify(value));
    await run(); assert.ok(await bucket.head(key));
  }
  assert.equal(bucket.deleted.length, 0);
});
test('linked PR lookup outages, rate limits, missing PRs and malformed state all fail closed', async () => {
  const pr = github.closed(); await link(pr);
  for (const status of [404, 403, 429, 503, 'network']) {
    github.fail = path => path === `/pulls/${pr.number}` ? status : 0;
    await run(); assert.ok(await bucket.head(key));
  }
  github.fail = undefined;
  pr.state = 'unexpected'; await run(); assert.ok(await bucket.head(key));
  pr.state = 'closed'; github.prs = []; await run(); assert.ok(await bucket.head(key));
  assert.equal(bucket.deleted.length, 0);
});
test('approved renamed resources survive even when association or PR verification is unavailable', async () => {
  github.refs.set(`submission/${id}`, github.main);
  const pr = github.makePR(`submission/${id}`); await link(pr); pr.head.ref = 'review/approved';
  pr.state = 'closed'; pr.merged = true; pr.merged_at = new Date().toISOString();
  await run(); assert.ok(await bucket.head(key));
  bucket.values.delete(associationKey(id)); github.setCatalog([], record());
  github.fail = path => path.startsWith('/pulls') ? 503 : 0;
  await run(); assert.ok(await bucket.head(key));
  assert.equal(bucket.deleted.length, 0);
});
test('orphan API failures retain and retry a genuinely uncreated submission', async () => {
  github.fail = path => path.startsWith('/pulls?') ? 503 : 0;
  await run(); assert.ok(await bucket.head(key));
  github.fail = undefined; await run(); assert.deepEqual(bucket.deleted, [key]);
});
test('an unexpected PR or changed association cancels orphan deletion', async () => {
  github.refs.set(`submission/${id}`, github.main);
  const pr = github.makePR(`submission/${id}`);
  // A PR exists despite durable not-created state: never infer it is an orphan.
  await run(); assert.ok(await bucket.head(key));
  github.prs = [];
  github.before = async (path, method) => {
    if (path === `/git/refs/heads/submission/${id}` && method === 'PATCH') await associate(bucket, id, 'creating');
  };
  await run(); assert.ok(await bucket.head(key));
  assert.equal(bucket.deleted.length, 0);
});

test('multiple PRs on a linked renamed branch remain ambiguous and retain the object', async () => {
  const first = github.closed(); await link(first);
  github.refs.set('review/multiple', first.head.sha); github.refs.delete(first.head.ref);
  first.head.ref = 'review/multiple'; github.makePR(first.head.ref);
  await run(); assert.ok(await bucket.head(key)); assert.equal(bucket.deleted.length, 0);
});
