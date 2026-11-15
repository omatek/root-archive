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
function harness({at = origin, change = () => {}, transport = false, nativeError = false, respond = () => undefined} = {}) {
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
      const custom = await respond(url, options);
      if (custom !== undefined) return custom;
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
  assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.ok(h.calls.every(c => c.method === 'GET'));
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

// Stateful backend contract simulations. These never contact hosted resources.
function raceHarness(kind, defect = '', winner = 0) {
  let current = record(4, 'pending'), writes = 0;
  current.submission.version = kind === 'metadata' ? 1 : 2;
  const h = harness({respond(url, options) {
    if (!url.startsWith(origin) || (!url.endsWith(id(4)) && options.method !== 'POST')) return;
    if (options.method === 'GET') return Response.json(current);
    const index = writes++;
    if (index !== winner) return Response.json({success: false}, {status: 409});
    current.submission.version++;
    if (kind === 'metadata' && defect !== 'unchanged') {
      Object.assign(current.submission, JSON.parse(options.body));
      current.submission.version = 2;
      if (defect === 'wrong-winner') current.submission.title = `Synthetic staging 4 race ${winner ? 'A' : 'B'}`;
    }
    if (kind === 'replacement' && defect !== 'unchanged') {
      const r = {...current.revisions[0], id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'replacement', filename: 'synthetic-client.png'};
      current.revisions.push(r); current.submission.candidate_revision_id = r.id;
      if (defect === 'original-deleted') current.revisions[0].status = 'deleted';
      if (['loser-ready', 'loser-uploading', 'loser-deleted'].includes(defect)) current.revisions.push({...r,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: defect === 'loser-ready' ? 'ready' : defect === 'loser-deleted' ? 'deleted' : 'uploading'});
    }
    const response = structuredClone(current);
    if (defect === 'response-disagrees') response.submission.candidate_revision_id = response.submission.original_revision_id;
    return Response.json(response);
  }});
  return h;
}
for (const winner of [0, 1]) {
  test(`metadata race verifies successful payload, winner ${winner}`, async () => {
    const result = await raceHarness('metadata', '', winner).load().metadataRace('MUTATE SYNTHETIC 4 METADATA');
    assert.equal(result.outcome, 'completed', JSON.stringify(result));
  });
  test(`replacement race verifies new candidate and original, winner ${winner}`, async () => {
    const result = await raceHarness('replacement', '', winner).load().replacementRace('MUTATE SYNTHETIC 4 REPLACEMENTS');
    assert.equal(result.outcome, 'completed', JSON.stringify(result));
  });
}
for (const defect of ['unchanged', 'wrong-winner']) test(`metadata race rejects ${defect} with correct HTTP/version`, async () => {
  const h = raceHarness('metadata', defect), api = h.load();
  const result = await api.metadataRace('MUTATE SYNTHETIC 4 METADATA');
  assert.equal(result.outcome, 'stopped'); assert.equal(result.message, 'Winning metadata mismatch');
  const count = h.calls.length;
  await assert.rejects(api.replacementRace('MUTATE SYNTHETIC 4 REPLACEMENTS'), /Mutation hold/);
  assert.equal(h.calls.length, count);
});
for (const defect of ['unchanged', 'original-deleted', 'loser-ready', 'loser-uploading', 'response-disagrees']) {
  test(`replacement race rejects ${defect} with correct HTTP/version`, async () => {
    assert.equal((await raceHarness('replacement', defect).load().replacementRace('MUTATE SYNTHETIC 4 REPLACEMENTS')).outcome, 'stopped');
  });
}
function boundaryHarness(states = new Map(), {loseFirst = false, unknownPrivate = false, drift = false} = {}) {
  let lost = false, targetReads = 0;
  const h = harness({respond(url, options) {
    const n = Number.parseInt(url.match(/[a-f0-9]{12}(?=\/|$)/)?.[0] || '', 16);
    const status = value => states.get(value)?.status || 'published';
    const make = value => {
      const d = record(value, status(value));
      d.submission.version = states.get(value)?.version || 2;
      if (d.submission.status === 'published') d.published = {id: id(value), status: 'published', revision_id: d.submission.candidate_revision_id};
      return d;
    };
    if (url.includes('/resources')) {
      const generation = [...states.values()].reduce((sum, v) => sum + v.version - 2, 0);
      const cursor = generation ? `issued_cursor_${generation}` : 'issued_cursor';
      if (url.includes('cursor=') && new URL(url).searchParams.get('cursor') !== cursor) return Response.json({code: 'catalog_changed'}, {status: 409});
      const all = Array.from({length: 201}, (_, i) => i + 5).filter(value => status(value) === 'published');
      const offset = url.includes('cursor=') ? 200 : 0;
      return Response.json({resources: all.slice(offset, offset + 200).map(value => ({id: id(value), course_id: '0401111', type: 'Summary',
        title: `Synthetic staging ${value}`, semester: 'Synthetic', contributor: null,
        asset_url: `https://api-staging.rootamman.com/download/${id(value)}`})), next_cursor: offset === 0 && all.length > 200 ? cursor : null});
    }
    if (n >= 5 && n <= 205 && !url.includes('/files/')) {
      if (url.includes('/download/')) return status(n) === 'published'
        ? new Response(new Uint8Array(1920), {headers: {'Content-Type': 'image/png', 'Cache-Control': 'no-store'}})
        : new Response(null, {status: 404});
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.equal(body.version, make(n).submission.version);
        states.set(n, {status: url.endsWith('/unpublish') ? 'unpublished' : 'published', version: body.version + 1});
        if (loseFirst && !lost) { lost = true; throw new Error('PRIVATE SENTINEL VALUE'); }
      }
      if (drift && n === 5 && options.method === 'GET' && ++targetReads === 2) states.set(5, {status: status(5), version: make(5).submission.version + 1});
      if (unknownPrivate && n === 10) { const d = make(n); d.submission.status = 'unpublished'; d.published = null; return Response.json(d); }
      return Response.json(make(n));
    }
  }});
  return h;
}
const boundaryPlan = () => ({targets: [id(5), id(205)], firstCursor: 'issued_cursor'});
test('one committed withdrawal survives lost response and resumes only remaining exact target after reload', async () => {
  const states = new Map(), h = boundaryHarness(states, {loseFirst: true}), api = h.load();
  const stopped = await api.withdrawBoundary('WITHDRAW TWO SYNTHETIC BOUNDARY RECORDS');
  assert.equal(stopped.outcome, 'stopped');
  assert.deepEqual(stopped.boundaryPlan, boundaryPlan());
  assert.equal(states.get(5).status, 'unpublished'); assert.equal(states.has(205), false);
  await assert.rejects(api.continueBoundary('withdraw', stopped.boundaryPlan, 'CONTINUE SYNTHETIC BOUNDARY WITHDRAW'), /Mutation hold/);
  // Simulates external reconciliation followed by reload; no in-client hold reset.
  const resumed = boundaryHarness(states), next = resumed.load();
  assert.equal((await next.readCatalog(200)).outcome, 'completed');
  const result = await next.continueBoundary('withdraw', stopped.boundaryPlan, 'CONTINUE SYNTHETIC BOUNDARY WITHDRAW');
  assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.result.changed, 1); assert.equal(result.result.alreadyComplete, 1);
  assert.deepEqual(resumed.calls.filter(c => c.method === 'POST').map(c => c.url), [origin + `/admin/api/submissions/${id(205)}/unpublish`]);
  const published = await next.republishBoundary('REPUBLISH TWO SYNTHETIC BOUNDARY RECORDS');
  assert.equal(published.outcome, 'completed', JSON.stringify(published)); assert.equal(published.result.count, 201);
});
test('one committed reapproval survives lost response and resumes without replaying completed approval', async () => {
  const states = new Map([[5, {status: 'unpublished', version: 3}], [205, {status: 'unpublished', version: 3}]]);
  const stopped = await boundaryHarness(states, {loseFirst: true}).load().republishBoundary('REPUBLISH TWO SYNTHETIC BOUNDARY RECORDS', boundaryPlan());
  assert.equal(stopped.outcome, 'stopped'); assert.deepEqual(stopped.boundaryPlan, boundaryPlan());
  const h = boundaryHarness(states);
  const result = await h.load().continueBoundary('republish', stopped.boundaryPlan, 'CONTINUE SYNTHETIC BOUNDARY REPUBLISH');
  assert.equal(result.outcome, 'completed', JSON.stringify(result)); assert.equal(result.result.changed, 1); assert.equal(result.result.alreadyComplete, 1);
  assert.deepEqual(h.calls.filter(c => c.method === 'POST').map(c => c.url), [origin + `/admin/api/submissions/${id(205)}/approve`]);
});
test('boundary continuation rejects changed, foreign, duplicate and missing plans before writes', async () => {
  for (const plan of [null, {...boundaryPlan(), targets: [id(1), id(205)]}, {...boundaryPlan(), targets: [id(5), id(5)]},
    {...boundaryPlan(), firstCursor: 'https://evil.example'}, {...boundaryPlan(), extra: true}]) {
    const h = boundaryHarness();
    assert.equal((await h.load().continueBoundary('withdraw', plan, 'CONTINUE SYNTHETIC BOUNDARY WITHDRAW')).outcome, 'stopped');
    assert.ok(h.calls.every(c => c.method === 'GET'));
  }
  const h = boundaryHarness(new Map(), {unknownPrivate: true});
  assert.equal((await h.load().continueBoundary('withdraw', boundaryPlan(), 'CONTINUE SYNTHETIC BOUNDARY WITHDRAW')).outcome, 'stopped');
  assert.ok(h.calls.every(c => c.method === 'GET'));
});
test('boundary continuation confirmation and action guards send no requests', async () => {
  for (const [action, phrase] of [['withdraw', 'wrong'], ['remove', 'CONTINUE SYNTHETIC BOUNDARY REMOVE']]) {
    const h = boundaryHarness();
    assert.equal((await h.load().continueBoundary(action, boundaryPlan(), phrase)).outcome, 'stopped');
    assert.equal(h.calls.length, 0);
  }
});

test('replacement accepts a reconciled deleted losing intent', async () => {
  const result = await raceHarness('replacement', 'loser-deleted').load().replacementRace('MUTATE SYNTHETIC 4 REPLACEMENTS');
  assert.equal(result.outcome, 'completed', JSON.stringify(result));
});
for (const action of ['withdraw', 'republish']) test(`completed ${action} continuation verifies without any replay`, async () => {
  const states = new Map([5, 205].map(n => [n, {status: action === 'withdraw' ? 'unpublished' : 'published', version: 4}]));
  const h = boundaryHarness(states);
  const result = await h.load().continueBoundary(action, boundaryPlan(), `CONTINUE SYNTHETIC BOUNDARY ${action.toUpperCase()}`);
  assert.equal(result.outcome, 'completed', JSON.stringify(result));
  assert.equal(result.result.changed, 0); assert.equal(result.result.alreadyComplete, 2);
  assert.ok(h.calls.every(c => c.method === 'GET' || c.method === 'HEAD'));
});
test('boundary target version drift stops before writing', async () => {
  const h = boundaryHarness(new Map(), {drift: true});
  const result = await h.load().continueBoundary('withdraw', boundaryPlan(), 'CONTINUE SYNTHETIC BOUNDARY WITHDRAW');
  assert.equal(result.outcome, 'stopped'); assert.equal(result.message, 'Boundary state changed; reconcile');
  assert.ok(h.calls.every(c => c.method === 'GET'));
});
test('installed boundary plan cannot be replaced by other owned target IDs', async () => {
  const h = boundaryHarness(), api = h.load();
  assert.equal((await api.withdrawBoundary('WITHDRAW TWO SYNTHETIC BOUNDARY RECORDS')).outcome, 'completed');
  const count = h.calls.filter(c => c.method === 'POST').length;
  const result = await api.continueBoundary('republish', {...boundaryPlan(), targets: [id(6), id(205)]}, 'CONTINUE SYNTHETIC BOUNDARY REPUBLISH');
  assert.equal(result.outcome, 'stopped'); assert.equal(result.message, 'Boundary plan changed');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, count);
});
