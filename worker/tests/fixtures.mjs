import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const config = JSON.parse(readFileSync(new URL('../../moderation.config.json', import.meta.url)));
export const workerConfig = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, ''));
export const courses = JSON.parse(readFileSync(new URL('../../site/courses.json', import.meta.url)));
export const origin = 'https://site.example.invalid';
export const id = '12345678-1234-4123-8123-123456789abc';
export const secondId = '22345678-1234-4123-8123-123456789abc';
export const key = `assets/v1/${id}.pdf`;
export const hour = 3600000;
export const day = 24 * hour;
export const resource = (submissionId = id) => ({id: submissionId, course_id: courses[0].id, type: 'Summary',
  title: 'Synthetic material', semester: 'Fall 2026', contributor: null,
  asset_url: `${config.asset_base_url}/assets/v1/${submissionId}.pdf`, created_at: '2026-01-01T00:00:00.000Z'});
export const record = (submissionId = id) => ({schema: 1, object_key: `assets/v1/${submissionId}.pdf`, resource: resource(submissionId)});
const clone = v => JSON.parse(JSON.stringify(v));
const hash = v => createHash('sha1').update(JSON.stringify(v)).digest('hex');
export const envFor = BUCKET => ({BUCKET, GITHUB_TOKEN: 'synthetic', GITHUB_OWNER: 'omatek', GITHUB_REPO: 'root-archive',
  TURNSTILE_SECRET: 'synthetic', ALLOWED_ORIGIN: origin, GOOGLE_CLIENT_ID: 'synthetic-client',
  R2_PUBLIC_BASE_URL: config.asset_base_url, CLEANUP_MODE: 'active'});

export const associationKey = submissionId => `moderation-control/submissions/${submissionId}.json`;
export const association = (submissionId = id, phase = 'not-created', prNumber) => ({schema: 1,
  repository: 'omatek/root-archive', submission_id: submissionId, object_key: `assets/v1/${submissionId}.pdf`,
  phase, ...(prNumber === undefined ? {} : {pr_number: prNumber})});
export const associate = (bucket, submissionId = id, phase = 'not-created', prNumber) =>
  bucket.put(associationKey(submissionId), JSON.stringify(association(submissionId, phase, prNumber)));
export const assets = bucket => [...bucket.values.values()].filter(o => o.key.startsWith('assets/'));

export class MemoryBucket {
  values = new Map();
  deleted = [];
  failDelete = false;
  failPut = false;
  nextVersion = 0;
  async put(key, value, options = {}) {
    if (this.failPut) throw new Error('mock_put_failure');
    const old = this.values.get(key);
    if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
    if (options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    const bytes = typeof value === 'string' ? value : Buffer.from(value);
    const item = {key, etag: hash(bytes), version: String(++this.nextVersion), size: bytes.length, uploaded: new Date(),
      customMetadata: options.customMetadata, value: bytes};
    this.values.set(key, item);
    return item;
  }
  async head(key) { return this.values.get(key) ?? null; }
  async get(key) {
    const value = await this.head(key);
    return value ? {...value, json: async () => JSON.parse(value.value)} : null;
  }
  async delete(key) {
    if (this.failDelete) throw new Error('mock_delete_failure');
    this.values.delete(key); this.deleted.push(key);
  }
  async list({prefix, limit, cursor}) {
    const values = [...this.values.values()].filter(o => o.key.startsWith(prefix) && (!cursor || o.key > cursor))
      .sort((a, b) => a.key.localeCompare(b.key));
    const objects = values.slice(0, limit).map(o => ({...o, uploaded: new Date(o.uploaded), customMetadata: {...o.customMetadata}}));
    return {objects, truncated: values.length > limit, cursor: objects.at(-1)?.key};
  }
  async seed(submissionId = id, age = 8 * day, metadata = true) {
    const key = `assets/v1/${submissionId}.pdf`;
    const created = new Date(Date.now() - age);
    await this.put(key, '%PDF-synthetic', {customMetadata: metadata ? {moderation_schema: '1', submission_id: submissionId,
      created_at: created.toISOString()} : {}});
    this.values.get(key).uploaded = created;
    await associate(this, submissionId);
    return key;
  }
}

export class GitHubMock {
  files = new Map();
  trees = new Map();
  commits = new Map();
  refs = new Map();
  prs = [];
  comments = [];
  reviews = [];
  inline = [];
  requests = [];
  fail;
  before;
  turnstile = true;
  verifications = [];
  jwks;
  constructor() {
    const files = {'site/resources.json': [], 'site/courses.json': courses};
    const tree = hash(files); this.trees.set(tree, files);
    this.main = hash({tree}); this.commits.set(this.main, {tree: {sha: tree}});
    this.refs.set('main', this.main);
  }
  setCatalog(catalog, receipt) {
    const files = {'site/resources.json': catalog, 'site/courses.json': courses};
    if (receipt) files[`submissions/${receipt.resource.id}.json`] = receipt;
    const tree = hash(files); this.trees.set(tree, files);
    this.main = hash({tree}); this.commits.set(this.main, {tree: {sha: tree}});
    this.refs.set('main', this.main);
  }
  closed(age = 2 * day, submissionId = id) {
    this.refs.set(`submission/${submissionId}`, this.main);
    const pr = this.makePR(`submission/${submissionId}`);
    pr.state = 'closed'; pr.closed_at = new Date(Date.now() - age).toISOString();
    return pr;
  }
  makePR(branch) {
    const pr = {number: this.prs.length + 1, state: 'open', merged: false, merged_at: null,
      closed_at: null, created_at: new Date(Date.now() - 40 * day).toISOString(),
      updated_at: new Date(Date.now() - 40 * day).toISOString(), user: {login: config.submission_author},
      base: {ref: 'main', repo: {full_name: 'omatek/root-archive'}},
      head: {ref: branch, sha: this.refs.get(branch), repo: {full_name: 'omatek/root-archive'}}};
    pr.html_url = `https://github.com/omatek/root-archive/pull/${pr.number}`;
    this.prs.push(pr); return pr;
  }
  async fetch(input, init = {}) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'www.googleapis.com') return Response.json(this.jwks);
    if (url.href === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      this.verifications.push({url: url.href, method: request.method,
        body: Object.fromEntries(new URLSearchParams(await request.text()))});
      return Response.json({success: this.turnstile});
    }
    if (url.origin === config.asset_base_url) return new Response('%PDF-public', {status: 200});
    if (url.hostname !== 'api.github.com') throw new Error('unexpected_network_host');
    const path = url.pathname.replace('/repos/omatek/root-archive', '') + url.search;
    const method = request.method;
    const body = method === 'GET' ? undefined : await request.json();
    this.requests.push({path, method, body});
    if (this.before) await this.before(path, method, body);
    const failed = this.fail?.(path, method, body);
    if (failed === 'network') throw new TypeError('synthetic network failure');
    if (failed) return Response.json({message: 'synthetic upstream error'}, {status: failed});
    const response = (value, status = 200) => Response.json(clone(value), {status});
    if (path.startsWith('/git/ref/heads/')) {
      const name = path.slice('/git/ref/heads/'.length);
      const value = this.refs.get(name);
      return value ? response({object: {sha: value, type: 'commit'}, ref: `refs/heads/${name}`}) : response({}, 404);
    }
    if (path.startsWith('/contents/')) {
      const p = url.pathname.split('/contents/')[1];
      const ref = url.searchParams.get('ref');
      const files = this.trees.get(this.commits.get(ref)?.tree.sha);
      if (!files || !(p in files)) return response({}, 404);
      const raw = JSON.stringify(files[p]);
      const size = Buffer.byteLength(raw);
      if (request.headers.get('Accept') === 'application/vnd.github.raw+json') {
        return new Response(raw, {headers: {'Content-Type': 'application/json', 'Content-Length': String(size)}});
      }
      const content = size > 1024 * 1024 ? '' : Buffer.from(raw).toString('base64');
      return response({type: 'file', encoding: size > 1024 * 1024 ? 'none' : 'base64', size, content});
    }
    if (path.startsWith('/git/commits/') && method === 'GET') return response(this.commits.get(path.split('/').at(-1)));
    if (path === '/git/trees') {
      const files = {...this.trees.get(body.base_tree)};
      for (const entry of body.tree) files[entry.path] = JSON.parse(entry.content);
      const sha = hash(files); this.trees.set(sha, files); return response({sha}, 201);
    }
    if (path === '/git/commits') {
      const sha = hash(body); this.commits.set(sha, {tree: {sha: body.tree}, parents: body.parents}); return response({sha}, 201);
    }
    if (path === '/git/refs') { this.refs.set(body.ref.slice(11), body.sha); return response({ref: body.ref}, 201); }
    if (path.startsWith('/git/refs/heads/')) {
      const name = path.slice('/git/refs/heads/'.length);
      if (this.refs.get(name) !== body.sha && !this.commits.get(body.sha)?.parents?.includes(this.refs.get(name))) return response({}, 422);
      this.refs.set(name, body.sha);
      for (const pr of this.prs.filter(p => p.head.ref === name)) pr.head.sha = body.sha;
      return response({object: {sha: body.sha}});
    }
    if (path.startsWith('/pulls?')) return response(this.prs.filter(pr => `omatek:${pr.head.ref}` === url.searchParams.get('head')));
    if (path === '/pulls' && method === 'POST') return response(this.makePR(body.head), 201);
    if (/^\/pulls\/\d+$/.test(path)) {
      const pr = this.prs.find(p => p.number === Number(path.split('/').at(-1)));
      if (body?.state === 'closed') { pr.state = 'closed'; pr.closed_at = new Date().toISOString(); }
      return pr ? response(pr) : response({}, 404);
    }
    if (/^\/issues\/\d+\/comments/.test(path)) {
      if (method === 'POST') {
        const comment = {id: this.comments.length + 1000, created_at: new Date().toISOString(), body: body.body,
          user: {login: config.submission_author}};
        this.comments.push(comment); this.prs[0].updated_at = comment.created_at; return response(comment, 201);
      }
      return response(this.comments);
    }
    if (/\/reviews\?/.test(path)) return response(this.reviews);
    if (/\/comments\?/.test(path)) return response(this.inline);
    throw new Error(`unmocked_${method}_${path}`);
  }
}
