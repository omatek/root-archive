import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../.wrangler/dist/worker.js';
import { readFileSync } from 'node:fs';
import { workerConfig } from './fixtures.mjs';
const config = JSON.parse(readFileSync(new URL('../../moderation.config.json', import.meta.url)));

const origin = 'https://site.example.invalid';
const env = {
  GITHUB_TOKEN: 'synthetic-placeholder', GITHUB_OWNER: 'example', GITHUB_REPO: 'test',
  TURNSTILE_SECRET: 'synthetic-placeholder', ALLOWED_ORIGIN: origin,
  GOOGLE_CLIENT_ID: 'synthetic-client', R2_PUBLIC_BASE_URL: config.asset_base_url,
  BUCKET: {put() { throw new Error('Unexpected storage access'); },
    delete() { throw new Error('Unexpected storage access'); }},
};
const request = (path, method, headers = {}) => new Request(`https://worker.example.invalid${path}`,
  {method, headers: {Origin: origin, ...headers}});

// Tests must remain offline and fail if a boundary check makes an upstream call.
const originalFetch = globalThis.fetch;
let networkCalls = 0;
test.before(() => { globalThis.fetch = () => {
  networkCalls++;
  throw new Error('Unexpected network access');
}; });
test.after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(networkCalls, 0, 'boundary tests must never call upstreams');
});

test('preflight succeeds for supported paths with exact CORS', async () => {
  for (const path of ['/', '/submit', '/auth/verify']) {
    const response = await worker.fetch(request(path, 'OPTIONS'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
});
test('missing and lookalike origins are rejected without CORS grant', async () => {
  for (const value of ['', 'null', `${origin}.attacker.invalid`, 'http://localhost:8000']) {
    const response = await worker.fetch(request('/', 'OPTIONS', {Origin: value}), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});
test('repository domain configuration grants exact CORS to both frontends on every supported path', async () => {
  const configuredEnv = { ...env, ALLOWED_ORIGIN: workerConfig.vars.ALLOWED_ORIGIN };
  assert.equal(workerConfig.vars.R2_PUBLIC_BASE_URL, config.asset_base_url);
  assert(workerConfig.routes.some(route => route.pattern === 'api.rootamman.com' && route.custom_domain === true));
  assert.equal(workerConfig.workers_dev, true, 'retain the existing fallback Worker host');
  for (const permitted of ['https://archive.rootamman.com', 'https://root-archive.pages.dev']) {
    for (const path of ['/', '/submit', '/auth/verify']) {
      const response = await worker.fetch(request(path, 'OPTIONS', {Origin: permitted}), configuredEnv);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), permitted);
      assert.equal(response.headers.get('Vary'), 'Origin');
      assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
      assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/);
      const denied = await worker.fetch(request(path, 'POST', {Origin: permitted}), configuredEnv);
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get('Access-Control-Allow-Origin'), permitted);
    }
  }
  for (const rejected of ['', 'null', 'https://rootamman.com', 'http://archive.rootamman.com',
    'https://archive.rootamman.com.attacker.invalid', 'https://root-archive.pages.dev.attacker.invalid',
    'https://preview.root-archive.pages.dev', 'http://localhost:8000']) {
    const response = await worker.fetch(request('/', 'OPTIONS', {Origin: rejected}), configuredEnv);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});
test('unsupported route and method retain their HTTP contract', async () => {
  assert.equal((await worker.fetch(request('/absent', 'POST'), env)).status, 404);
  const response = await worker.fetch(request('/', 'GET'), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST, OPTIONS');
});
test('missing and malformed tokens fail before storage or network', async () => {
  for (const path of ['/', '/submit', '/auth/verify']) {
    for (const Authorization of ['', 'Basic synthetic', 'Bearer invalid', 'Bearer a.b.c']) {
      const response = await worker.fetch(request(path, 'POST', {Authorization}), env);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).success, false);
    }
  }
});
test('missing configuration fails closed', async () => {
  assert.equal((await worker.fetch(request('/', 'OPTIONS'), {...env, GITHUB_TOKEN: ''})).status, 500);
});
