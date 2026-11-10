import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import worker from '../.wrangler/dist/worker.js';
import { GitHubMock, MemoryBucket, envFor, courses, origin } from './fixtures.mjs';

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
  assert.equal(github.prs.length, 1); assert.equal(bucket.values.size, 1);
  const pr = github.prs[0]; const files = github.trees.get(github.commits.get(pr.head.sha).tree.sha);
  assert.equal(files['site/resources.json'].length, 1);
  const resource = files['site/resources.json'][0];
  assert.deepEqual(files[`submissions/${resource.id}.json`].resource, resource);
  assert.equal(resource.asset_url, `${env.R2_PUBLIC_BASE_URL}/${[...bucket.values.keys()][0]}`);
  assert.equal(JSON.stringify(files).includes('synthetic@'), false);
  // Simulate approved merge: the exact proposal becomes the production source.
  github.refs.set('main', pr.head.sha); pr.state = 'closed'; pr.merged = true; pr.merged_at = new Date().toISOString();
  await worker.scheduled({}, env); assert.equal(bucket.deleted.length, 0);
});
test('cryptographic signature and claim failures reject before upload', async () => {
  const now = Math.floor(Date.now()/1000);
  for (const patch of [{iss: 'https://attacker.invalid'}, {aud: 'wrong-client'}, {exp: now - 60},
    {iat: now + 3600}, {iat: now - 90000}, {email_verified: false}, {sub: ''}, {exp: undefined}]) {
    assert.equal((await submit({}, await token(patch))).status, 401);
  }
  assert.equal((await submit({}, await token({}, wrongKey))).status, 401);
  assert.equal(bucket.values.size, 0);
});
test('exact email and hosted domain authorization', async () => {
  for (const patch of [{email: 'synthetic@aum.edu.jo'}, {email: 'synthetic@std.aum.edu.jo.attacker.invalid'},
    {email: 'synthetic@sub.std.aum.edu.jo'}, {hd: 'aum.edu.jo'}, {hd: undefined}]) {
    assert.equal((await submit({}, await token(patch))).status, 403);
  }
  assert.equal(bucket.values.size, 0);
});
test('Turnstile failure performs no storage or GitHub mutations', async () => {
  github.turnstile = false; assert.equal((await submit()).status, 403);
  assert.equal(bucket.values.size, 0); assert.equal(github.requests.length, 0);
});
test('MIME, extension, binary signature and metadata restrictions', async () => {
  for (const file of [new File(['%PDF-bad'], 'x.exe', {type: 'application/pdf'}),
    new File(['%PDF-bad'], 'x.pdf', {type: 'text/plain'}), new File(['not a PDF'], 'x.pdf', {type: 'application/pdf'}),
    new File([], 'x.pdf', {type: 'application/pdf'})]) assert.equal((await submit({file})).status, 400);
  for (const patch of [{title: '<script>alert(1)</script>'}, {title: 'line\nbreak'}, {object_key: 'arbitrary'},
    {course_id: '9999999'}, {contributor: '\u202eunsafe'}, {type: 'unknown'}]) assert.equal((await submit(patch)).status, 400);
  assert.equal(bucket.values.size, 0);
});
test('oversized body is rejected using declared and actual streaming size', async () => {
  assert.equal((await submit({}, undefined, {'Content-Length': String(26 * 1024 * 1024)})).status, 413);
  assert.equal((await submit({file: new File([new Uint8Array(25 * 1024 * 1024)], 'x.pdf', {type: 'application/pdf'})})).status, 413);
  assert.equal(bucket.values.size, 0);
});
test('GitHub definitive failure rolls back R2, failed rollback retains trusted provenance', async () => {
  github.fail = (path, method) => path === '/pulls' && method === 'POST' ? 422 : 0;
  assert.equal((await submit()).status, 502); assert.equal(bucket.values.size, 0); assert.equal(bucket.deleted.length, 1);
  bucket.failDelete = true; assert.equal((await submit()).status, 502);
  assert.equal(bucket.values.size, 1);
  assert.equal([...bucket.values.values()][0].customMetadata.moderation_schema, '1');
});
test('ambiguous PR creation outcome retains R2 for later reconciliation', async () => {
  github.fail = (path, method) => path === '/pulls' && method === 'POST' ? 'network' : 0;
  assert.equal((await submit()).status, 502); assert.equal(bucket.values.size, 1); assert.equal(bucket.deleted.length, 0);
});
test('R2 storage failure never creates a GitHub PR', async () => {
  bucket.failPut = true; assert.equal((await submit()).status, 502); assert.equal(github.requests.length, 0);
});
test('simultaneous submissions have distinct generated object keys and independent single PRs', async () => {
  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map(r => r.status), [201, 201]);
  assert.equal(bucket.values.size, 2); assert.equal(github.prs.length, 2);
  assert.notEqual(github.prs[0].head.ref, github.prs[1].head.ref);
});
