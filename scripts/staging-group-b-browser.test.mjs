// Offline CLIENT GUARDS only. No network, hosted app, Access session or storage.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';

const source = readFileSync(new URL('./staging-group-b-browser.js', import.meta.url), 'utf8');
const origin = 'https://admin.archive.rootamman.com';
const sha = '1324f212d3fdc38a04671664d9e87bf203d9982696eeff2373ce4ea9f1251383';
const id = n => `726f6f74-6172-4368-8000-${n.toString(16).padStart(12, '0')}`;
function record(n, status = n === 2 ? 'rejected' : 'removed') {
  const terminal = ['removed', 'rejected'].includes(status);
  return {submission: {id: id(n), version: 1, status, course_id: '0401111', type: 'Summary',
    title: terminal ? 'Removed material' : `Synthetic staging ${n}`, semester: terminal ? '' : 'Synthetic',
    contributor: null, contributor_email: null, contributor_sub: null,
    original_revision_id: terminal ? null : id(n).replace('-8000-', '-9000-'),
    candidate_revision_id: terminal ? null : id(n).replace('-8000-', '-9000-')},
  revisions: [{id: id(n).replace('-8000-', '-9000-'), kind: 'original', filename: terminal ? 'removed' : 'synthetic.png',
    mime: 'image/png', size: 1920, status: terminal ? 'deleted' : 'ready'}], published: null, audit: []};
}
function harness({at = origin, change = () => {}, transport = false, nativeError = false} = {}) {
  const calls = [], window = {};
  window.top = window.self = window;
  for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, {get() { throw new Error('Credential store touched'); }});
  const context = vm.createContext({window, location: {origin: at}, Object, Map, Set, Number, Array,
    FormData, Blob, AbortSignal, AbortController, TextEncoder, structuredClone, setTimeout, clearTimeout,
    // Fixed digest for fake 1920-byte fixture only. Guard tests do not test hashing.
    crypto: {subtle: {digest: async (algorithm, bytes) => bytes.byteLength === 1920 ? Buffer.from(sha, 'hex') : webcrypto.subtle.digest(algorithm, bytes)}},
    fetch: async (url, options) => {
      calls.push({url, ...options});
      assert.ok(url.startsWith(origin + '/admin/api/submissions') || url.startsWith('https://api-staging.rootamman.com/'));
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, url.startsWith(origin) ? 'same-origin' : 'omit');
      assert.ok(!Object.keys(options.headers).some(k => /authorization|cookie|access.*assertion/i.test(k)));
      if (nativeError) throw new Error('PRIVATE SENTINEL VALUE');
      if (options.method === 'POST' && transport) throw new Error('PRIVATE SENTINEL VALUE');
      if (url.includes('/files/')) return new Response(new Uint8Array(1920), {headers: {'Content-Type': 'image/png'}});
      if (url.includes('/download/')) return new Response(null, {status: 404});
      let data;
      if (url.includes('?view=')) data = {submissions: [], next_cursor: null};
      else {
        const n = Number.parseInt(url.split('/').at(-1).slice(-12), 16);
        data = record(n, n === 4 ? 'pending' : undefined);
      }
      change(data, url);
      return Response.json(data);
    }});
  return {calls, load() { vm.runInContext(source, context); return window.rootArchiveStagingAcceptance; }};
}

test('loading sends no requests; rejects other origins and duplicate installation', () => {
  for (const at of ['https://admin.archive.rootamman.com.evil.example', 'http://admin.archive.rootamman.com', 'https://api-staging.rootamman.com']) {
    const h = harness({at}); assert.throws(() => h.load(), /Wrong staging context/); assert.equal(h.calls.length, 0);
  }
  const h = harness(); h.load(); assert.equal(h.calls.length, 0); assert.throws(() => h.load(), /already loaded/);
});
test('all mutation confirmations reject before any request', async () => {
  for (const method of ['metadataRace', 'replacementRace', 'interruptReplacement', 'approvalRace', 'publishPagination', 'withdrawBoundary', 'republishBoundary']) {
    const h = harness(); const result = await h.load()[method]('wrong');
    assert.equal(result.outcome, 'stopped'); assert.equal(h.calls.length, 0);
  }
  const h = harness(); await h.load().cleanup('pagination', 'bad', 'wrong'); assert.equal(h.calls.length, 0);
});
test('read-only inventory uses GET; never reads credential stores or returns actor fields', async () => {
  const h = harness({change(data) { data.audit?.push({actor: 'PRIVATE SENTINEL VALUE'}); }});
  const result = await h.load().inspect();
  assert.equal(result.outcome, 'completed'); assert.ok(h.calls.every(c => c.method === 'GET'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE SENTINEL'));
});
test('unknown queue IDs stop before mutation', async () => {
  const h = harness({change(data) { if (data.submissions) data.submissions.push({id: 'outside-manifest'}); }});
  const result = await h.load().metadataRace('MUTATE SYNTHETIC 4 METADATA');
  assert.equal(result.outcome, 'stopped'); assert.ok(h.calls.every(c => c.method === 'GET'));
});
test('identity-bearing records stop before mutation and hide private data', async () => {
  const h = harness({change(data) { if (data.submission) data.submission.contributor_email = 'PRIVATE SENTINEL VALUE'; }});
  const result = await h.load().metadataRace('MUTATE SYNTHETIC 4 METADATA');
  assert.equal(result.outcome, 'stopped'); assert.ok(h.calls.every(c => c.method === 'GET'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE SENTINEL'));
});
test('native read errors cannot leak arbitrary messages into receipts', async () => {
  const h = harness({nativeError: true}); const result = await h.load().inspect();
  assert.equal(result.outcome, 'stopped'); assert.ok(!JSON.stringify(result).includes('PRIVATE SENTINEL'));
});
test('ambiguous simultaneous writes are not retried and hold all later mutations', async () => {
  const h = harness({transport: true}), api = h.load();
  const result = await api.metadataRace('MUTATE SYNTHETIC 4 METADATA');
  assert.equal(result.outcome, 'stopped'); assert.equal(h.calls.filter(c => c.method === 'POST').length, 2);
  const count = h.calls.length;
  await assert.rejects(api.approvalRace('MUTATE SYNTHETIC 4 DECISIONS'), /Mutation hold/);
  assert.equal(h.calls.length, count); assert.ok(!JSON.stringify(api.report()).includes('PRIVATE SENTINEL'));
});
test('wrong cleanup hash and unknown cleanup scope cannot delete', async () => {
  const h = harness(), api = h.load();
  const result = await api.cleanup('recovery', 'wrong-hash', 'DELETE OWNED SYNTHETIC STAGING RECOVERY');
  assert.equal(result.outcome, 'stopped'); assert.ok(h.calls.every(c => c.method === 'GET'));
  const other = harness(); await other.load().cleanupPlan('production'); assert.equal(other.calls.length, 0);
});
test('incomplete public traversal stops instead of claiming pagination success', async () => {
  const h = harness({change(data, url) {
    if (url.includes('/resources')) { delete data.submission; data.resources = []; data.next_cursor = null; }
  }});
  const result = await h.load().readCatalog(201);
  assert.equal(result.outcome, 'stopped'); assert.ok(h.calls.every(c => c.method === 'GET'));
});
