import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse } from 'miniflare';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { GitHubMock, envFor, courses, origin, id, day, associate, associationKey } from './fixtures.mjs';

// Real local workerd + emulated R2. All external hosts use this in-process mock.
test('workerd signed-token submission, emulated R2 storage, public asset read and conditional cursor writes', async () => {
  const github = new GitHubMock();
  const {privateKey, publicKey} = await generateKeyPair('RS256');
  github.jwks = {keys: [{...await exportJWK(publicKey), kid: 'workerd-test', alg: 'RS256', use: 'sig'}]};
  const {BUCKET, ...bindings} = envFor(null);
  const mf = new Miniflare(convertV4MiniflareOptions({unsafeTriggerHandlers: true, workers: [
    {name: 'submission', modules: true, scriptPath: new URL('../.wrangler/dist/worker.js', import.meta.url).pathname,
      compatibilityDate: '2025-02-01', r2Buckets: {BUCKET: 'local-assets'}, bindings,
      outboundService: async request => {
        try {
        const response = await github.fetch(new Request(request.url, {method: request.method, headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()}));
        return new MiniflareResponse(await response.arrayBuffer(), {status: response.status, headers: response.headers});
        } catch (error) { console.error("fixture error", request.url, error); throw error; }
      }},
    {name: 'public-assets', modules: true, r2Buckets: {PUBLIC: 'local-assets'}, compatibilityDate: '2025-02-01',
      script: 'export default { async fetch(r, env) { if (r.method !== "GET") return new Response(null, {status:405}); const o = await env.PUBLIC.get(new URL(r.url).pathname.slice(1)); return o ? new Response(o.body) : new Response(null, {status:404}); }}'},
  ]}));
  try {
    const jwt = await new SignJWT({email: 'synthetic@std.aum.edu.jo', hd: 'std.aum.edu.jo', email_verified: true})
      .setProtectedHeader({alg: 'RS256', kid: 'workerd-test'}).setIssuer('https://accounts.google.com')
      .setAudience(bindings.GOOGLE_CLIENT_ID).setSubject('synthetic').setIssuedAt().setExpirationTime('1h').sign(privateKey);
    const data = new FormData();
    for (const [key, value] of Object.entries({course_id: courses[0].id, type: 'Summary', title: 'Workerd fixture',
      semester: 'Fall 2026', turnstile_token: 'synthetic'})) data.set(key, value);
    data.set('file', new File(['%PDF-workerd'], 'fixture.pdf', {type: 'application/pdf'}));
    const request = new Request('https://worker.invalid/submit', {method: 'POST',
      headers: {Origin: origin, Authorization: `Bearer ${jwt}`}, body: data});
    const response = await mf.dispatchFetch(request.url, {method: 'POST',
      headers: Object.fromEntries(request.headers), body: await request.arrayBuffer()});
    assert.equal(response.status, 201, await response.text());
    const bucket = await mf.getR2Bucket('BUCKET');
    const objects = await bucket.list({prefix: 'assets/v1/', include: ['customMetadata']});
    assert.equal(objects.objects.length, 1);
    const object = objects.objects[0]; assert.equal(object.customMetadata.moderation_schema, '1');
    const linked = await (await bucket.get(associationKey(object.customMetadata.submission_id))).json();
    assert.equal(linked.phase, 'linked'); assert.equal(linked.pr_number, github.prs[0].number);
    assert.equal(await (await bucket.get(object.key)).text(), '%PDF-workerd');
    // Local public-host fixture shares the actual uploaded bucket. Anonymous
    // reads bypass the submission Worker, Google and GitHub entirely. This is
    // a contract test; staging must verify real public R2 permissions.
    const publicHost = await mf.getWorker('public-assets');
    const upstreamCalls = github.requests.length;
    assert.equal(await (await publicHost.fetch(`https://assets.invalid/${object.key}`)).text(), '%PDF-workerd');
    for (const method of ['POST', 'DELETE']) assert.equal((await publicHost.fetch(`https://assets.invalid/${object.key}`, {method})).status, 405);
    assert.equal(github.requests.length, upstreamCalls);
    const approvedFiles = github.trees.get(github.commits.get(github.prs[0].head.sha).tree.sha);
    const approved = approvedFiles['site/resources.json'][0];
    github.setCatalog([approved], approvedFiles[`submissions/${approved.id}.json`]);
    github.prs[0].merged = true; github.prs[0].merged_at = new Date().toISOString(); github.prs[0].state = 'closed';
    const rejectedKey = `assets/v1/${id}.pdf`;
    await bucket.put(rejectedKey, '%PDF-rejected', {customMetadata: {moderation_schema: '1', submission_id: id,
      created_at: new Date().toISOString()}});
    const rejectedPR = github.closed(2 * day, id);
    await associate(bucket, id, 'linked', rejectedPR.number);
    github.refs.set('review/workerd-renamed-rejection', rejectedPR.head.sha);
    github.refs.delete(rejectedPR.head.ref); rejectedPR.head.ref = 'review/workerd-renamed-rejection';
    // Miniflare's local-only trigger dispatches the actual scheduled handler.
    for (let i = 0; i < 2; i++) {
      const scheduled = await mf.dispatchFetch('http://worker.invalid/cdn-cgi/local/scheduled');
      assert.equal(scheduled.status, 200, await scheduled.text());
    }
    assert.ok(await bucket.head(rejectedKey));
    assert.equal(github.requests.some(r => r.method === 'PATCH'), false);
    assert.ok(await bucket.head(object.key));
    const cursor = await bucket.put('moderation-control/test.json', '{}', {onlyIf: {etagDoesNotMatch: '*'}});
    assert.ok(cursor);
    assert.equal(await bucket.put('moderation-control/test.json', 'overwrite', {onlyIf: {etagDoesNotMatch: '*'}}), null);
    assert.equal(await bucket.put('moderation-control/test.json', 'overwrite', {onlyIf: {etagMatches: 'wrong'}}), null);
    assert.ok(await bucket.put('moderation-control/test.json', '{"cursor":"next"}', {onlyIf: {etagMatches: cursor.etag}}));
    const firstUpload = await bucket.put('moderation-control/identity-fixture', 'identical bytes');
    const restored = await bucket.put('moderation-control/identity-fixture', 'identical bytes');
    assert.equal(firstUpload.etag, restored.etag);
    assert.notEqual(firstUpload.version, restored.version);
  } finally { await mf.dispose(); }
});
