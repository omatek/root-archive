import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {git} from './submission-git.mjs';
import {config, courses, resource, id} from '../worker/tests/fixtures.mjs';

function runFixture({currentPatch = {}, secondPatch, permissions = ['write'], noApp = false, reportedAppId = 10001} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'archive-auth-'));
  const write = (path, value) => {mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), JSON.stringify(value));};
  try {
    git(dir, ['init', '-q', '-b', 'main']); git(dir, ['config', 'user.name', 'Fixture']); git(dir, ['config', 'user.email', 'fixture@example.invalid']);
    write('site/courses.json', courses); write('site/resources.json', [resource()]); write('moderation.config.json', config);
    git(dir, ['add', '.']); git(dir, ['commit', '-qm', 'approved base']); const base = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['switch', '-qc', 'maintenance']); write('site/resources.json', []); git(dir, ['add', '.']); git(dir, ['commit', '-qm', 'remove approved resource']);
    const head = git(dir, ['rev-parse', 'HEAD']); git(dir, ['update-ref', 'refs/pull/17/head', head]); git(dir, ['remote', 'add', 'origin', dir]); git(dir, ['switch', '-q', 'main']);
    const pr = {number: 17, state: 'open', user: {login: 'maintainer'}, labels: [{name: 'catalog-maintenance'}],
      head: {sha: head, ref: 'maintenance', repo: {full_name: 'omatek/root-archive'}},
      base: {sha: base, ref: 'main', repo: {full_name: 'omatek/root-archive'}}};
    const merge = patch => ({...pr, ...patch, head: {...pr.head, ...patch.head}, base: {...pr.base, ...patch.base}});
    const current = merge(currentPatch);
    const versions = [current, secondPatch ? merge(secondPatch) : current];
    write('event.json', {pull_request: pr});
    const writes = join(dir, 'writes.jsonl');
    const mock = join(dir, 'mock.mjs');
    writeFileSync(mock, `import {appendFileSync} from 'node:fs';
      let prReads=0, permissionReads=0; const versions=${JSON.stringify(versions)}, permissions=${JSON.stringify(permissions)};
      globalThis.fetch=async (input, options={})=>{
        const url=new URL(input); if(url.hostname!=='api.github.com') throw new Error('Offline fixture');
        if(options.method==='POST'||options.method==='PATCH') {
          const body=JSON.parse(options.body); appendFileSync(${JSON.stringify(writes)}, JSON.stringify({...body,path:url.pathname,authorization:options.headers.Authorization})+'\\n');
          return Response.json({id:37,app:{id:${reportedAppId}}});
        }
        if(url.pathname.endsWith('/pulls/17')) return Response.json(versions[Math.min(prReads++,versions.length-1)]);
        if(url.pathname.includes('/collaborators/')) return Response.json({permission: permissions[Math.min(permissionReads++,permissions.length-1)]});
        throw new Error('Unexpected fixture request');
      };`);
    const result = spawnSync(process.execPath, ['--import', mock, new URL('./validate-submission.mjs', import.meta.url).pathname], {
      cwd: dir, encoding: 'utf8', env: {...process.env, GITHUB_EVENT_PATH: join(dir, 'event.json'),
        GITHUB_REPOSITORY: 'omatek/root-archive', GITHUB_RUN_ID: '123', GITHUB_TOKEN: 'fixture-read',
        PUBLICATION_CHECK_TOKEN: noApp ? '' : 'fixture-app', PUBLICATION_APP_ID: '10001'}});
    let reports = [];
    try { reports = readFileSync(writes, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { /* No credential => no reports. */ }
    return {exitCode: result.status, reports, head};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
const succeeded = r => r.reports.some(c => c.state === 'success' || c.conclusion === 'success');

test('security regression: stale event labels cannot authorize current unlabeled maintenance', () => {
  const r = runFixture({currentPatch: {labels: []}}); assert.equal(succeeded(r), false);
});
test('security regression: label removal during validation is checked again before success', () => {
  const r = runFixture({secondPatch: {labels: []}}); assert.equal(succeeded(r), false);
});
test('security regression: revoked permission is re-read before success', () => {
  const r = runFixture({permissions: ['write', 'read']}); assert.equal(succeeded(r), false);
});
test('current author, branch, base and already-revoked permission override event metadata', () => {
  for (const options of [{currentPatch: {user: {login: 'untrusted'}}, permissions: ['read']},
    {currentPatch: {head: {ref: `submission/${id}`}}},
    {currentPatch: {base: {ref: 'other'}}},
    {permissions: ['read']}]) assert.equal(succeeded(runFixture(options)), false);
});
test('current authorized maintenance reports success only through a distinct App check', () => {
  const r = runFixture(); assert.equal(r.exitCode, 0); assert.equal(succeeded(r), true);
  assert.equal(r.reports[0].head_sha, r.head);
  assert.ok(r.reports.every(c => c.authorization === 'Bearer fixture-app'));
  assert.equal(r.reports.some(c => c.path.includes('/statuses/')), false);
});
test('missing App credential cannot fall back to GitHub Actions reporting', () => {
  const r = runFixture({noApp: true}); assert.notEqual(r.exitCode, 0); assert.equal(succeeded(r), false);
});

test('an App identity mismatch cannot publish a successful check', () => {
  const r = runFixture({reportedAppId: 15368}); assert.notEqual(r.exitCode, 0); assert.equal(succeeded(r), false);
});
