/* REVIEW CANDIDATE ONLY. Loading defines commands; it sends ZERO requests.
 * See docs/staging-browser-client.md before review or execution.
 * No imports, credential inspection, persistence, arbitrary URLs, or seed route.
 */
(() => {
  'use strict';
  const ADMIN = 'https://admin.archive.rootamman.com';
  const PUBLIC = 'https://api-staging.rootamman.com';
  const SHA = '1324f212d3fdc38a04671664d9e87bf203d9982696eeff2373ce4ea9f1251383';
  const NAME = 'rootArchiveStagingAcceptance';
  if (location.origin !== ADMIN || window.top !== window.self) throw new Error('Wrong staging context');
  if (Object.hasOwn(window, NAME)) throw new Error('Client already loaded; reload before replacing it');
  const id = n => `726f6f74-6172-4368-8000-${n.toString(16).padStart(12, '0')}`;
  const revision = n => id(n).replace('-8000-', '-9000-');
  const numbers = Array.from({length: 205}, (_, i) => i + 1);
  const pagination = numbers.slice(4);
  const owned = new Map(numbers.map(n => [id(n), n]));
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  let busy = false, held = false, abortAttempted = false, boundary = null;
  let lastReport = null;
  class ClientStop extends Error {}
  const check = (ok, code) => { if (!ok) throw new ClientStop(code); };
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    b => b.toString(16).padStart(2, '0')).join('');
  function confirm(actual, expected) { check(actual === expected, 'Confirmation required'); }
  function scope(name) {
    check(name === 'recovery' || name === 'pagination', 'Unknown scope');
    return name === 'recovery' ? [4] : pagination;
  }
  function recordPath(n) {
    check(Number.isInteger(n) && n >= 1 && n <= 205, 'Outside manifest');
    return `/admin/api/submissions/${id(n)}`;
  }
  // All route construction is private. Exposed commands accept no URLs or payloads.
  async function request(path, {method = 'GET', body, publicRead = false, signal} = {}) {
    check(location.origin === ADMIN, 'Wrong staging context');
    check(publicRead ? method === 'GET' || method === 'HEAD' : path.startsWith('/admin/api/submissions'), 'Route guard');
    const headers = {Accept: 'application/json'};
    if (method === 'POST') {
      headers['X-Requested-With'] = 'root-admin';
      if (!(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    }
    try {
      return await fetch((publicRead ? PUBLIC : ADMIN) + path, {
        method, headers, body, signal: signal || AbortSignal.timeout(30000),
        credentials: publicRead ? 'omit' : 'same-origin', redirect: 'error', cache: 'no-store',
      });
    } catch {
      if (method === 'POST') held = true;
      throw new ClientStop(method === 'POST' ? 'Ambiguous write: reconcile before further mutations' : 'Read failed: check session/network');
    }
  }
  async function json(response, allowed = [200]) {
    if (response.status >= 500) held = true;
    check(allowed.includes(response.status), `Unexpected HTTP ${response.status}`);
    check((response.headers.get('Content-Type') || '').includes('application/json'), 'Expected JSON; check session');
    try { return await response.json(); }
    catch { held = true; throw new ClientStop('Unconfirmed response: reconcile'); }
  }
  function validate(data, n) {
    const s = data.submission;
    check(s && s.id === id(n) && Number.isSafeInteger(s.version) && s.version >= 1, 'Record mismatch');
    check(['pending', 'under_review', 'published', 'unpublished', 'removed', 'rejected'].includes(s.status), 'Record state mismatch');
    check(s.contributor === null && s.contributor_email === null && s.contributor_sub === null, 'Identity/ownership mismatch');
    check(s.course_id === '0401111' && s.type === 'Summary', 'Course/type mismatch');
    const terminal = ['removed', 'rejected'].includes(s.status);
    check(terminal ? s.title === 'Removed material' && s.semester === '' && s.candidate_revision_id === null && s.original_revision_id === null
      : s.semester === 'Synthetic' && (s.title === `Synthetic staging ${n}` ||
        n === 4 && ['Synthetic staging 4 race A', 'Synthetic staging 4 race B'].includes(s.title)), 'Synthetic metadata mismatch');
    check(Array.isArray(data.revisions) && data.revisions.length >= 1 && data.revisions.length <= (n === 4 ? 4 : n === 3 ? 2 : 1), 'Revision budget mismatch');
    const seen = new Set();
    for (const r of data.revisions) {
      check(uuid.test(r.id) && !seen.has(r.id), 'Revision ID mismatch'); seen.add(r.id);
      check(r.mime === 'image/png' && r.size > 0 && r.size <= 65536, 'Synthetic file bounds');
      check(['ready', 'uploading', 'delete_pending', 'deleted'].includes(r.status), 'Revision state mismatch');
      check(r.kind === 'original' ? r.id === revision(n) : r.kind === 'replacement' && (n === 3 || n === 4), 'Revision scope mismatch');
      check(r.status === 'deleted' || r.filename === 'removed' || ['synthetic.png', 'synthetic-client.png', 'cleaned-resource.png'].includes(r.filename), 'Filename mismatch');
    }
    check(data.revisions.filter(r => r.kind === 'original').length === 1, 'Original mismatch');
    if (!terminal) check(data.revisions.some(r => r.id === s.candidate_revision_id && r.status === 'ready'), 'Candidate not ready');
    if (data.published) check(data.published.id === s.id && data.published.status === s.status &&
      (terminal ? data.published.revision_id === null : seen.has(data.published.revision_id)), 'Snapshot mismatch');
    check(s.status !== 'published' || data.published?.revision_id === s.candidate_revision_id, 'Publication mismatch');
    return data;
  }
  async function detail(n) { return validate(await json(await request(recordPath(n))), n); }
  const safe = d => ({id: d.submission.id, version: d.submission.version, status: d.submission.status,
    candidate: d.submission.candidate_revision_id, revisions: d.revisions.map(r => ({id: r.id, status: r.status}))});
  async function revisionBytes(n, r) {
    check(r?.status === 'ready' && r.size === 1920, 'Candidate size mismatch');
    const response = await request(`${recordPath(n)}/files/${r.id}`);
    check(response.status === 200 && response.headers.get('Content-Type') === 'image/png', 'Private file unavailable');
    const bytes = await response.arrayBuffer();
    check(bytes.byteLength === 1920 && await hash(bytes) === SHA, 'Fixture bytes mismatch');
    return bytes;
  }
  async function candidateBytes(n, d) {
    return revisionBytes(n, d.revisions.find(r => r.id === d.submission.candidate_revision_id));
  }
  async function inventory() {
    const found = new Set();
    for (const view of ['pending', 'published', 'history']) {
      let cursor = null;
      for (let page = 0; page < 6; page++) {
        const data = await json(await request(`/admin/api/submissions?view=${view}${cursor === null ? '' : `&cursor=${cursor}`}`));
        check(Array.isArray(data.submissions) && data.submissions.length <= 50, 'Queue shape mismatch');
        for (const row of data.submissions) {
          check(owned.has(row.id) && !found.has(row.id) && row.contributor === null && row.contributor_email === null, 'Unknown/duplicate queue record');
          found.add(row.id);
        }
        if (data.next_cursor === null) break;
        check(data.next_cursor === String((page + 1) * 50) && page < 5, 'Queue cursor mismatch');
        cursor = data.next_cursor;
      }
    }
    for (const n of [1, 2, 3]) {
      const d = await detail(n);
      check(d.submission.status === (n === 2 ? 'rejected' : 'removed') && d.revisions.every(r => r.status === 'deleted'), 'Historical cleanup incomplete');
    }
    return {visibleRecords: found.size, historicalTerminal: 3};
  }
  async function post(n, action, body) {
    check(n >= 4, 'Historical writes forbidden');
    const response = await request(`${recordPath(n)}/${action}`, {method: 'POST', body});
    return {status: response.status, data: await json(response, [200, 409])};
  }
  async function decision(n, action, d, extra = {}) {
    const result = await post(n, action, {version: d.submission.version, ...extra});
    check(result.status === 200, 'Unexpected decision conflict; reconcile');
    return validate(result.data, n);
  }
  async function privateDenied(n) {
    for (const method of ['GET', 'HEAD']) {
      const r = await request(`/download/${id(n)}`, {method, publicRead: true});
      check(r.status === 404, 'STOP: unpublished file accessible');
    }
  }
  async function publicBytes(n) {
    const r = await request(`/download/${id(n)}`, {publicRead: true});
    check(r.status === 200 && r.headers.get('Content-Type') === 'image/png', 'Public file unavailable');
    check((r.headers.get('Cache-Control') || '').includes('no-store'), 'Download caching mismatch');
    const bytes = await r.arrayBuffer();
    check(bytes.byteLength === 1920 && await hash(bytes) === SHA, 'Public bytes mismatch');
  }
  function publicRow(r) {
    const n = owned.get(r.id);
    check(n >= 5 && n <= 205 && r.course_id === '0401111' && r.type === 'Summary' &&
      r.title === `Synthetic staging ${n}` && r.semester === 'Synthetic' && r.contributor == null &&
      r.asset_url === `${PUBLIC}/download/${r.id}`, 'Unexpected public resource');
    check(Object.keys(r).every(k => ['id', 'course_id', 'type', 'title', 'semester', 'contributor', 'asset_url', 'created_at'].includes(k)), 'Unexpected public field');
    return n;
  }
  async function catalog(expected) {
    check([0, 199, 201].includes(expected), 'Unsupported catalog size');
    const ids = [], pages = []; let cursor = null, firstCursor = null;
    for (let page = 0; page < 2; page++) {
      const response = await request(`/resources${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {publicRead: true});
      const data = await json(response);
      check(Array.isArray(data.resources) && data.resources.length <= 200, 'Catalog shape mismatch');
      pages.push(data.resources.map(publicRow)); ids.push(...pages.at(-1));
      if (data.next_cursor === null) { cursor = null; break; }
      check(page === 0 && typeof data.next_cursor === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(data.next_cursor), 'Catalog cursor mismatch');
      cursor = data.next_cursor; firstCursor = cursor;
    }
    check(cursor === null && ids.length === expected && new Set(ids).size === ids.length, 'Incomplete/duplicate catalog');
    if (expected === 201) check(pagination.every(n => ids.includes(n)) && pages[0].length === 200 && pages[1].length === 1, 'Pagination membership mismatch');
    return {count: ids.length, pages: pages.map(p => p.length), ids, firstCursor};
  }
  async function command(phase, work, mutation = false) {
    check(!busy, 'Another client command is running');
    check(!mutation || !held, 'Mutation hold: external reconciliation required');
    busy = true;
    try {
      const result = await work();
      lastReport = {phase, outcome: 'completed', observed_at: new Date().toISOString(), result};
    } catch (error) {
      held = true;
      // Only our fixed messages survive; native/parser/server messages never do.
      const message = error instanceof ClientStop ? error.message : 'Stopped; reconcile before retry';
      lastReport = {phase, outcome: 'stopped', observed_at: new Date().toISOString(), message};
    } finally { busy = false; }
    return structuredClone(lastReport);
  }
  async function startMutation(phrase, expected) {
    confirm(phrase, expected); await inventory();
  }
  async function pair(n, requests, before) {
    const results = await Promise.allSettled(requests);
    check(results.every(r => r.status === 'fulfilled'), 'Ambiguous race; external reconciliation required');
    check(results.map(r => r.value.status).sort().join(',') === '200,409', 'Race must yield one success and one conflict');
    const d = await detail(n);
    check(d.submission.version === before + 1, 'Race version mismatch');
    return d;
  }
  async function upload(n, version, bytes, signal) {
    const body = new FormData(); body.set('version', String(version));
    body.set('file', new Blob([bytes], {type: 'image/png'}), 'synthetic-client.png');
    const response = await request(`${recordPath(n)}/revisions`, {method: 'POST', body, signal});
    return {status: response.status, data: await json(response, [200, 409])};
  }
  async function cleanupSnapshot(name) {
    const rows = [];
    for (const n of scope(name)) {
      const d = await detail(n);
      check(d.submission.status !== 'rejected' && d.revisions.every(r => r.status === 'ready' || r.status === 'deleted'), 'Cleanup hold: unresolved revision');
      if (d.submission.status !== 'removed') {
        for (const r of d.revisions.filter(r => r.status === 'ready')) await revisionBytes(n, r);
      }
      rows.push(safe(d));
    }
    return {scope: name, records: rows, hash: await hash(new TextEncoder().encode(JSON.stringify(rows)))};
  }
  const api = {
    version: 'review-candidate-1',
    inspect: () => command('read-only inventory', inventory),
    inspectRecovery: () => command('read-only recovery record', async () => safe(await detail(4))),
    readCatalog: expected => command('read-only catalog', async () => {
      const c = await catalog(expected); return {count: c.count, pages: c.pages, ids: c.ids.map(id)};
    }),
    metadataRace: phrase => command('MUTATION metadata race', async () => {
      await startMutation(phrase, 'MUTATE SYNTHETIC 4 METADATA');
      const d = await detail(4); check(d.submission.status === 'pending' && d.submission.version === 1, 'Need fresh fixture 4');
      await candidateBytes(4, d); await privateDenied(4);
      const payload = title => ({version: 1, course_id: '0401111', type: 'Summary', title, semester: 'Synthetic', contributor: null});
      const after = await pair(4, ['A', 'B'].map(x => post(4, 'metadata', payload(`Synthetic staging 4 race ${x}`))), 1);
      await privateDenied(4); return safe(after);
    }, true),
    replacementRace: phrase => command('MUTATION overlapping replacements', async () => {
      await startMutation(phrase, 'MUTATE SYNTHETIC 4 REPLACEMENTS');
      const d = await detail(4); check(d.submission.version === 2 && d.revisions.length === 1 && d.submission.status === 'pending', 'Replacement race state mismatch');
      const bytes = await candidateBytes(4, d);
      const after = await pair(4, [upload(4, 2, bytes), upload(4, 2, bytes)], 2);
      await candidateBytes(4, after); await privateDenied(4);
      check(after.revisions.every(r => r.status === 'ready' || r.status === 'deleted'), 'Reconcile losing upload before continuing');
      return safe(after);
    }, true),
    interruptReplacement: phrase => command('MUTATION one client-aborted replacement', async () => {
      await startMutation(phrase, 'INTERRUPT SYNTHETIC 4 ONCE');
      check(!abortAttempted, 'Abort already attempted in this client');
      const d = await detail(4); check(d.submission.version === 3 && d.submission.status === 'pending' && d.revisions.length <= 3, 'Interruption state mismatch');
      const bytes = await candidateBytes(4, d), controller = new AbortController();
      abortAttempted = true;
      const timer = setTimeout(() => controller.abort(), 200);
      let responseStatus = null, transportUnconfirmed = false;
      try { responseStatus = (await upload(4, d.submission.version, bytes, controller.signal)).status; }
      catch { transportUnconfirmed = true; held = true; }
      finally { clearTimeout(timer); }
      // Abort may precede receipt, or the server may commit after this read.
      // Never retry here; external D1/R2 reconciliation is mandatory in ALL cases.
      held = true;
      const after = await detail(4); await privateDenied(4);
      return {responseStatus, transportUnconfirmed, externalReconciliationRequired: true, state: safe(after),
        claim: 'Client interruption attempt only; server receipt/storage failure not established'};
    }, true),
    approvalRace: phrase => command('MUTATION approval retry and approval/withdrawal race', async () => {
      await startMutation(phrase, 'MUTATE SYNTHETIC 4 DECISIONS');
      let d = await detail(4);
      check(d.submission.status === 'pending' && [3, 4].includes(d.submission.version) && d.revisions.every(r => ['ready', 'deleted'].includes(r.status)), 'Reconcile fixture 4 before decisions');
      await candidateBytes(4, d);
      const body = {version: d.submission.version, revision_id: d.submission.candidate_revision_id};
      d = await decision(4, 'approve', d, {revision_id: body.revision_id});
      await publicBytes(4);
      const replay = await post(4, 'approve', body);
      check(replay.status === 200 && validate(replay.data, 4).submission.version === d.submission.version, 'Approval retry changed version');
      const v = d.submission.version;
      d = await pair(4, [post(4, 'approve', {version: v, revision_id: body.revision_id}),
        post(4, 'unpublish', {version: v, reason: 'Synthetic decision race'})], v);
      if (d.submission.status === 'published') d = await decision(4, 'unpublish', d, {reason: 'Synthetic recovery fixture hold'});
      check(d.submission.status === 'unpublished', 'Unexpected race decision'); await privateDenied(4);
      return safe(d);
    }, true),
    publishPagination: phrase => command('MUTATION approve 201 pagination fixtures', async () => {
      await startMutation(phrase, 'PUBLISH SYNTHETIC 5 THROUGH 205');
      check(['unpublished', 'removed'].includes((await detail(4)).submission.status), 'Keep recovery fixture private before pagination');
      // Validate ALL targets before the first write. Each is re-read before use.
      for (const n of pagination) {
        const d = await detail(n); check(['pending', 'published'].includes(d.submission.status) && d.revisions.length === 1, 'Pagination start state mismatch');
        await candidateBytes(n, d);
      }
      let approved = 0, alreadyPublished = 0;
      for (const n of pagination) {
        let d = await detail(n); await candidateBytes(n, d);
        if (d.submission.status === 'published') { alreadyPublished++; continue; }
        check(d.submission.status === 'pending', 'Pagination state changed');
        await privateDenied(n);
        d = await decision(n, 'approve', d, {revision_id: revision(n)});
        check(d.submission.status === 'published', 'Approval state mismatch'); approved++;
      }
      const c = await catalog(201); await publicBytes(c.ids[0]); await publicBytes(c.ids.at(-1));
      return {approved, alreadyPublished, count: c.count, pages: c.pages};
    }, true),
    withdrawBoundary: phrase => command('MUTATION withdraw across catalog boundary', async () => {
      await startMutation(phrase, 'WITHDRAW TWO SYNTHETIC BOUNDARY RECORDS');
      const c = await catalog(201); const targets = [c.ids[0], c.ids[200]];
      boundary = targets; // Recoverable from exactly two unpublished records after reload.
      for (const n of targets) {
        const d = await detail(n); await candidateBytes(n, d);
        check(d.submission.status === 'published', 'Boundary record not published');
        await decision(n, 'unpublish', d, {reason: 'Synthetic pagination boundary'}); await privateDenied(n);
      }
      const response = await request(`/resources?cursor=${encodeURIComponent(c.firstCursor)}`, {publicRead: true});
      const changed = await json(response, [409]); check(changed.code === 'catalog_changed', 'Old API cursor not invalidated');
      const after = await catalog(199); check(targets.every(n => !after.ids.includes(n)), 'Withdrawn record in catalog');
      return {withdrawn: targets.map(id), oldApiIssuedCursorStatus: 409, count: after.count, pages: after.pages};
    }, true),
    republishBoundary: phrase => command('MUTATION republish boundary records', async () => {
      await startMutation(phrase, 'REPUBLISH TWO SYNTHETIC BOUNDARY RECORDS');
      const targets = [];
      for (const n of pagination) {
        const d = await detail(n); check(['published', 'unpublished'].includes(d.submission.status), 'Unexpected pagination state');
        if (d.submission.status === 'unpublished') targets.push(n);
      }
      check(targets.length === 2 && (!boundary || targets.every(n => boundary.includes(n))), 'Boundary ownership/state mismatch');
      for (const n of targets) {
        const d = await detail(n); await candidateBytes(n, d);
        await decision(n, 'approve', d, {revision_id: revision(n)}); await publicBytes(n);
      }
      const c = await catalog(201); return {republished: targets.map(id), count: c.count, pages: c.pages};
    }, true),
    cleanupPlan: name => command('READ ONLY destructive-cleanup plan', async () => {
      scope(name); await inventory(); return cleanupSnapshot(name);
    }),
    cleanup: (name, planHash, phrase) => command('DESTRUCTIVE synthetic permanent removal', async () => {
      scope(name); await startMutation(phrase, `DELETE OWNED SYNTHETIC STAGING ${name.toUpperCase()}`);
      const plan = await cleanupSnapshot(name);
      check(typeof planHash === 'string' && planHash === plan.hash, 'Cleanup plan hash mismatch');
      const oldCursor = name === 'pagination' && plan.records.every(r => r.status === 'published')
        ? (await catalog(201)).firstCursor : null;
      let removed = 0, alreadyRemoved = 0;
      for (const n of scope(name)) {
        const d = await detail(n);
        check(JSON.stringify(safe(d)) === JSON.stringify(plan.records.find(r => r.id === id(n))), 'Cleanup state changed; make new plan');
        if (d.submission.status === 'removed') { alreadyRemoved++; continue; }
        await candidateBytes(n, d);
        const after = await decision(n, 'remove', d, {reason: 'Synthetic approved campaign cleanup'});
        check(after.submission.status === 'removed', 'Removal incomplete'); await privateDenied(n); removed++;
        if (oldCursor && removed === 1) {
          const response = await request(`/resources?cursor=${encodeURIComponent(oldCursor)}`, {publicRead: true});
          check((await json(response, [409])).code === 'catalog_changed', 'Removal failed to invalidate API cursor');
        }
        // Existing remove can invoke global bounded cleanup. Any unresolved
        // deletion stops this command; no unscoped /cleanup endpoint is exposed.
        check(after.revisions.every(r => r.status === 'deleted'), 'Deletion pending; external reconciliation required');
      }
      if (name === 'pagination') await catalog(0);
      return {removed, alreadyRemoved, externalR2AndAuditVerificationRequired: true};
    }, true),
    report: () => structuredClone(lastReport),
  };
  Object.defineProperty(window, NAME, {value: Object.freeze(api), configurable: false, writable: false});
})();
