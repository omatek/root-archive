import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import worker from '../.wrangler/dist/worker.js';
import { GitHubMock, MemoryBucket, envFor, courses, origin, assets, associationKey, resource, workerConfig } from './fixtures.mjs';

const {privateKey, publicKey} = await generateKeyPair('RS256');
const jwk = {...await exportJWK(publicKey), kid: 'synthetic', alg: 'RS256', use: 'sig'};
const {privateKey: wrongKey} = await generateKeyPair('RS256');
const token = (patch = {}, key = privateKey) => new SignJWT({email: 'synthetic@std.aum.edu.jo', hd: 'std.aum.edu.jo',
  email_verified: true, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600,
  sub: 'synthetic', aud: 'synthetic-client', iss: 'https://accounts.google.com', ...patch})
  .setProtectedHeader({alg: 'RS256', kid: 'synthetic'}).sign(key);
let github, bucket, env;
const original = globalThis.fetch;
test.beforeEach(() => { github = new GitHubMock(); github.jwks = {keys: [jwk]}; bucket = new MemoryBucket();
  env = envFor(bucket); globalThis.fetch = github.fetch.bind(github); });
test.after(() => { globalThis.fetch = original; });
function form(patch = {}) {
  const data = new FormData();
  const fields = {course_id: courses[0].id, title: 'Synthetic material', semester: 'Fall 2026', type: 'Summary',
    turnstile_token: 'synthetic', file: new File(['%PDF-synthetic'], 'safe.pdf', {type: 'application/pdf'}), ...patch};
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}
async function submit(patch = {}, jwt, headers = {}) {
  return worker.fetch(new Request('https://worker.invalid/submit', {method: 'POST', body: form(patch),
    headers: {Origin: origin, Authorization: `Bearer ${jwt ?? await token()}`, ...headers}}), env);
}

test('eligible signed student upload creates one atomic catalog PR and no public success asset link', async () => {
  const response = await submit();
  assert.equal(response.status, 201);
  const data = await response.json(); assert.equal(data.asset_url, undefined); assert.match(data.pr_url, /\/pull\/1$/);
  assert.equal(github.prs.length, 1); assert.equal(assets(bucket).length, 1);
  const pr = github.prs[0]; const files = github.trees.get(github.commits.get(pr.head.sha).tree.sha);
  assert.equal(files['site/resources.json'].length, 1);
  const resource = files['site/resources.json'][0];
  assert.deepEqual(files[`submissions/${resource.id}.json`].resource, resource);
  assert.equal(resource.asset_url, `${env.R2_PUBLIC_BASE_URL}/${assets(bucket)[0].key}`);
  assert.equal(JSON.stringify(files).includes('synthetic@'), false);
  // Simulate approved merge: the exact proposal becomes the production source.
  github.refs.set('main', pr.head.sha); pr.state = 'closed'; pr.merged = true; pr.merged_at = new Date().toISOString();
  await worker.scheduled({}, env); assert.equal(bucket.deleted.length, 0);
});
test('both frontend origins can verify and submit on the API domain using the existing Siteverify flow', async () => {
  env.ALLOWED_ORIGIN = workerConfig.vars.ALLOWED_ORIGIN;
  const jwt = await token();
  for (const frontend of ['https://archive.rootamman.com', 'https://root-archive.pages.dev']) {
    const headers = {Origin: frontend, Authorization: `Bearer ${jwt}`, 'CF-Connecting-IP': '192.0.2.10'};
    const before = github.verifications.length;
    const auth = await worker.fetch(new Request('https://api.rootamman.com/auth/verify', {method: 'POST', headers}), env);
    assert.equal(auth.status, 200);
    assert.equal(auth.headers.get('Access-Control-Allow-Origin'), frontend);
    assert.deepEqual(await auth.json(), {success: true, authorized: true});
    const invalid = await worker.fetch(new Request('https://api.rootamman.com/', {method: 'POST', headers,
      body: form({turnstile_token: ''})}), env);
    assert.equal(invalid.status, 400);
    assert.equal(github.verifications.length, before, 'sign-in and invalid forms do not call Siteverify');
    for (const path of ['/', '/submit']) {
      const response = await worker.fetch(new Request(`https://api.rootamman.com${path}`, {method: 'POST', headers, body: form()}), env);
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), frontend);
      assert.equal((await response.json()).asset_url, undefined);
    }
    assert.equal(github.verifications.length, before + 2, 'one verification per validated submission');
  }
  for (const verification of github.verifications) {
    assert.equal(verification.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(verification.method, 'POST');
    assert.deepEqual(verification.body, {secret: env.TURNSTILE_SECRET, response: 'synthetic', remoteip: '192.0.2.10'});
  }
  assert.equal(assets(bucket).length, 4);
  assert.equal(github.prs.length, 4);
});
test('Siteverify transport, HTTP and malformed-response failures stop uploads and moderation writes', async () => {
  for (const failure of ['network', 'http', 'json', 'missing-success']) {
    globalThis.fetch = (input, init) => {
      if (String(input) !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return github.fetch(input, init);
      if (failure === 'network') throw new TypeError('synthetic network failure');
      if (failure === 'http') return new Response('unavailable', {status: 503});
      if (failure === 'json') return new Response('not JSON');
      return Response.json({});
    };
    const response = await submit();
    assert.equal(response.status, failure === 'missing-success' ? 403 : 502);
    assert.equal(assets(bucket).length, 0);
    assert.equal(github.requests.length, 0);
  }
});
test('cryptographic signature and claim failures reject before upload', async () => {
  const now = Math.floor(Date.now()/1000);
  for (const patch of [{iss: 'https://attacker.invalid'}, {aud: 'wrong-client'}, {exp: now - 60},
    {iat: now + 3600}, {iat: now - 90000}, {email_verified: false}, {sub: ''}, {exp: undefined}]) {
    assert.equal((await submit({}, await token(patch))).status, 401);
  }
  assert.equal((await submit({}, await token({}, wrongKey))).status, 401);
  assert.equal(assets(bucket).length, 0);
});
test('exact email and hosted domain authorization', async () => {
  for (const patch of [{email: 'synthetic@aum.edu.jo'}, {email: 'synthetic@std.aum.edu.jo.attacker.invalid'},
    {email: 'synthetic@sub.std.aum.edu.jo'}, {hd: 'aum.edu.jo'}, {hd: undefined}]) {
    assert.equal((await submit({}, await token(patch))).status, 403);
  }
  assert.equal(assets(bucket).length, 0);
});
test('Turnstile failure performs no storage or GitHub mutations', async () => {
  github.turnstile = false; assert.equal((await submit()).status, 403);
  assert.equal(assets(bucket).length, 0); assert.equal(github.requests.length, 0);
});
test('MIME, extension, binary signature and metadata restrictions', async () => {
  for (const file of [new File(['%PDF-bad'], 'x.exe', {type: 'application/pdf'}),
    new File(['%PDF-bad'], 'x.pdf', {type: 'text/plain'}), new File(['not a PDF'], 'x.pdf', {type: 'application/pdf'}),
    new File([], 'x.pdf', {type: 'application/pdf'})]) assert.equal((await submit({file})).status, 400);
  for (const patch of [{title: '<script>alert(1)</script>'}, {title: 'line\nbreak'}, {object_key: 'arbitrary'},
    {course_id: '9999999'}, {contributor: '\u202eunsafe'}, {type: 'unknown'}]) assert.equal((await submit(patch)).status, 400);
  assert.equal(assets(bucket).length, 0);
});
test('oversized body is rejected using declared and actual streaming size', async () => {
  assert.equal((await submit({}, undefined, {'Content-Length': String(26 * 1024 * 1024)})).status, 413);
  assert.equal((await submit({file: new File([new Uint8Array(25 * 1024 * 1024)], 'x.pdf', {type: 'application/pdf'})})).status, 413);
  assert.equal(assets(bucket).length, 0);
});
test('GitHub definitive failure rolls back R2, failed rollback retains trusted provenance', async () => {
  github.fail = (path, method) => path === '/pulls' && method === 'POST' ? 422 : 0;
  assert.equal((await submit()).status, 502); assert.equal(assets(bucket).length, 0); assert.equal(bucket.deleted.length, 1);
  bucket.failDelete = true; assert.equal((await submit()).status, 502);
  assert.equal(assets(bucket).length, 1);
  assert.equal(assets(bucket)[0].customMetadata.moderation_schema, '1');
});
test('ambiguous PR creation outcome retains R2 for later reconciliation', async () => {
  github.fail = (path, method) => path === '/pulls' && method === 'POST' ? 'network' : 0;
  assert.equal((await submit()).status, 502); assert.equal(assets(bucket).length, 1); assert.equal(bucket.deleted.length, 0);
});
test('R2 storage failure never creates a GitHub PR', async () => {
  bucket.failPut = true; assert.equal((await submit()).status, 502); assert.equal(github.requests.length, 0);
});
test('simultaneous submissions have distinct generated object keys and independent single PRs', async () => {
  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map(r => r.status), [201, 201]);
  assert.equal(assets(bucket).length, 2); assert.equal(github.prs.length, 2);
  assert.notEqual(github.prs[0].head.ref, github.prs[1].head.ref);
});

test('stable PR association is durable across branch rename and an old upload retains active review', async () => {
  assert.equal((await submit()).status, 201);
  const asset = assets(bucket)[0]; const pr = github.prs[0];
  const saved = await (await bucket.get(associationKey(asset.customMetadata.submission_id))).json();
  assert.equal(saved.phase, 'linked'); assert.equal(saved.pr_number, pr.number);
  assert.equal(saved.object_key, asset.key); assert.equal(saved.repository, 'omatek/root-archive');
  const created = new Date(Date.now() - 8 * 86400000);
  asset.uploaded = created; asset.customMetadata.created_at = created.toISOString();
  github.refs.set('review/renamed-upload', pr.head.sha); github.refs.delete(pr.head.ref);
  pr.head.ref = 'review/renamed-upload'; pr.updated_at = new Date().toISOString();
  await worker.scheduled({}, env);
  assert.ok(await bucket.head(asset.key)); assert.equal(bucket.deleted.length, 0);
});
test('definite PR failure with failed rollback retains a remaining branch for owner cleanup', async () => {
  github.fail = (path, method) => path === '/pulls' && method === 'POST' ? 422 : 0;
  bucket.failDelete = true;
  assert.equal((await submit()).status, 502);
  const asset = assets(bucket)[0];
  const saved = await (await bucket.get(associationKey(asset.customMetadata.submission_id))).json();
  assert.equal(saved.phase, 'not-created'); assert.equal(saved.pr_number, undefined);
  const created = new Date(Date.now() - 8 * 86400000);
  asset.uploaded = created; asset.customMetadata.created_at = created.toISOString();
  bucket.failDelete = false; github.fail = undefined;
  await worker.scheduled({}, env);
  assert.ok(await bucket.head(asset.key));
  assert.equal(github.requests.some(r => r.method === 'PATCH'), false);
});
test('lost PR creation response retains durable intent even after remote branch rename', async () => {
  github.before = (path, method, body) => {
    if (path === '/pulls' && method === 'POST') {
      const pr = github.makePR(body.head);
      github.refs.set('review/lost-response', pr.head.sha); github.refs.delete(pr.head.ref);
      pr.head.ref = 'review/lost-response';
    }
  };
  github.fail = (path, method) => path === '/pulls' && method === 'POST' ? 'network' : 0;
  assert.equal((await submit()).status, 502);
  const asset = assets(bucket)[0];
  assert.equal((await (await bucket.get(associationKey(asset.customMetadata.submission_id))).json()).phase, 'creating');
  const created = new Date(Date.now() - 8 * 86400000);
  asset.uploaded = created; asset.customMetadata.created_at = created.toISOString();
  github.before = undefined; github.fail = undefined;
  await worker.scheduled({}, env);
  assert.ok(await bucket.head(asset.key)); assert.equal(bucket.deleted.length, 0);
});
test('regression: failed association persistence returns a verified existing PR URL', async () => {
  const put = bucket.put.bind(bucket);
  bucket.put = async (key, value, options) => {
    if (key.startsWith('moderation-control/submissions/') && JSON.parse(value).phase === 'linked') throw new Error('mock_link_write_failure');
    return put(key, value, options);
  };
  const originalWarn = console.warn; const warnings = [];
  console.warn = message => warnings.push(JSON.parse(message));
  let response;
  try { response = await submit(); } finally { console.warn = originalWarn; }
  assert.equal(response.status, 201);
  assert.equal((await response.json()).pr_url, github.prs[0].html_url);
  const asset = assets(bucket)[0];
  assert.equal(github.prs.length, 1); assert.equal(bucket.deleted.length, 0);
  assert.equal((await (await bucket.get(associationKey(asset.customMetadata.submission_id))).json()).phase, 'creating');
  const repair = warnings.find(w => w.event === 'submission_association_repair_needed');
  assert.deepEqual(repair, {event: 'submission_association_repair_needed',
    id: asset.customMetadata.submission_id, pr_number: github.prs[0].number, verified: true});
  assert.equal(JSON.stringify(warnings).includes(env.GITHUB_TOKEN), false);
  const uploaded = new Date(Date.now() - 8 * 86400000);
  asset.uploaded = uploaded; asset.customMetadata.created_at = uploaded.toISOString();
  await worker.scheduled({}, env); assert.ok(await bucket.head(asset.key));
});
test('failure to durably record creation intent prevents the PR POST and permits safe rollback', async () => {
  const put = bucket.put.bind(bucket);
  bucket.put = async (key, value, options) => {
    if (key.startsWith('moderation-control/submissions/') && JSON.parse(value).phase === 'creating') return null;
    return put(key, value, options);
  };
  assert.equal((await submit()).status, 500);
  assert.equal(github.requests.some(r => r.path === '/pulls' && r.method === 'POST'), false);
  assert.equal(assets(bucket).length, 0);
});


test('pre-branch GitHub failure with failed rollback still cleans a proven orphan', async () => {
  github.fail = (path, method) => path === '/git/trees' && method === 'POST' ? 422 : 0;
  bucket.failDelete = true; assert.equal((await submit()).status, 502);
  const asset = assets(bucket)[0]; const created = new Date(Date.now() - 8 * 86400000);
  asset.uploaded = created; asset.customMetadata.created_at = created.toISOString();
  bucket.failDelete = false; github.fail = undefined;
  await worker.scheduled({}, env); assert.equal(await bucket.head(asset.key), null);
});


test('regression: catalog larger than 1 MB is retrieved raw at the pinned commit', async () => {
  const catalog = Array.from({length: 4000}, (_, i) => ({...resource(), id: `published-${i}`,
    title: 'X'.repeat(120), asset_url: `https://assets.example.invalid/${i}.pdf`}));
  const bytes = Buffer.byteLength(JSON.stringify(catalog));
  assert.ok(bytes > 1024 * 1024 && bytes < 4 * 1024 * 1024);
  github.setCatalog(catalog); const base = github.main;
  const response = await submit(); assert.equal(response.status, 201);
  assert.ok(github.requests.some(r => r.path === `/contents/site/resources.json?ref=${base}`));
  const files = github.trees.get(github.commits.get(github.prs[0].head.sha).tree.sha);
  assert.equal(files['site/resources.json'].length, catalog.length + 1);
});

test('association recovery does not return success when PR verification is unavailable', async () => {
  const put = bucket.put.bind(bucket);
  bucket.put = async (key, value, options) => {
    if (key.startsWith('moderation-control/submissions/') && JSON.parse(value).phase === 'linked') throw new Error('mock_link_write_failure');
    return put(key, value, options);
  };
  github.fail = (path, method) => path === '/pulls/1' && method === 'GET' ? 503 : 0;
  assert.equal((await submit()).status, 502);
  assert.equal(github.prs.length, 1); assert.equal(bucket.deleted.length, 0);
  assert.ok(assets(bucket)[0]);
});
test('association recovery rejects a PR that no longer matches the submitted commit', async () => {
  const put = bucket.put.bind(bucket);
  bucket.put = async (key, value, options) => {
    if (key.startsWith('moderation-control/submissions/') && JSON.parse(value).phase === 'linked') throw new Error('mock_link_write_failure');
    return put(key, value, options);
  };
  github.before = (path, method) => {if (path === '/pulls/1' && method === 'GET') github.prs[0].head.sha = 'a'.repeat(40);};
  assert.equal((await submit()).status, 502);
  assert.equal(bucket.deleted.length, 0); assert.ok(assets(bucket)[0]);
});
