import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { CONFIG, TYPES } from '../../site/js/config.mjs';

const root = resolve(fileURLToPath(new URL('../../site/', import.meta.url)));
const realCourses = JSON.parse(await readFile(resolve(root, 'courses.json')));
const realResources = JSON.parse(await readFile(resolve(root, 'resources.json')));
const axeSource = await readFile(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
// Reproduce a browser retaining the unversioned pre-filter form styles.
const staleFormStyles = 'input,select{width:100%;min-height:46px}';
const fakeCredential = `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
const fixture = {
  id: 'synthetic-1', course_id: '0401212', type: 'Summary', title: 'Synthetic resource for browser tests',
  semester: 'Fall 2026', contributor: 'Synthetic contributor', asset_url: 'https://assets.example.invalid/test.pdf',
  created_at: '2026-11-01T00:00:00.000Z'
};
const pdf = { name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nSynthetic test fixture, not a published resource.') };
let browser, server, origin;
before(async () => {
  server = createServer(async (req, res) => {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const target = path === root ? resolve(root, 'index.html') : path;
      const content = await readFile(target);
      res.setHeader('Content-Type', ({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(target)] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function setup(options = {}) {
  const appOrigin = options.frontendOrigin || origin;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  // No external request can leave a browser test. GIS, Turnstile and Worker are explicit mocks.
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url === appOrigin + '/courses.json') {
      if (options.failLoad) return route.fulfill({ status: 503, body: 'unavailable' });
      return route.fulfill({ json: options.courses || realCourses });
    }
    if (url === appOrigin + '/resources.json') {
      if (options.privateModeration) requests.push({type: 'static-resources', url});
      return route.fulfill({ json: options.staticResources || options.resources || realResources });
    }
    if (options.privateModeration && url === appOrigin + '/js/config.mjs') {
      const config = await readFile(resolve(root, 'js/config.mjs'), 'utf8');
      return route.fulfill({contentType: 'text/javascript', body: config.replace('privateModeration: false', 'privateModeration: true')});
    }
    if (options.staleStylesheet && url === appOrigin + '/styles.css') {
      return route.fulfill({ contentType: 'text/css', body: staleFormStyles });
    }
    if (url.startsWith(appOrigin + '/')) {
      if (appOrigin === origin) return route.continue();
      // Exercise the real frontend under either hostname using only local files.
      const local = new URL(url); local.host = new URL(origin).host; local.protocol = 'http:';
      return route.fulfill({ response: await route.fetch({ url: local.href }) });
    }
    if (options.externalFailure) return route.abort();
    if (url.startsWith(CONFIG.resourcesEndpoint)) {
      requests.push({type: 'resources', url, method: request.method(), headers: request.headers()});
      if (options.resourceApiFailure) return route.fulfill({status: 503, body: 'unavailable'});
      const cursor = new URL(url).searchParams.get('cursor');
      if(cursor !== null && options.changeCatalog){
        options.apiPages=options.changeCatalog;options.changeCatalog=null;
        return route.fulfill({status:409,json:{code:'catalog_changed'}});
      }
      const pages = options.apiPages || [{resources: options.resources || [], next_cursor: null}];
      const index=cursor===null?0:pages.findIndex((_,i)=>i>0&&pages[i-1].next_cursor===cursor);
      return route.fulfill({json: pages[index]});
    }
    if (url.startsWith('https://accounts.google.com/gsi/client')) {
      return route.fulfill({ contentType: 'text/javascript', body: `window.google = { accounts: { id: {
        initialize(options) { window.testIdentity = options; },
        renderButton(slot) { const button = document.createElement('button'); button.type='button'; button.textContent='Google sign-in (simulated)'; button.onclick=()=>window.testIdentity.callback({credential:window.testCredential || ${JSON.stringify(fakeCredential)}}); slot.append(button); },
        disableAutoSelect() { window.testAutoSelectDisabled = (window.testAutoSelectDisabled || 0) + 1; }
      } } };` });
    }
    if (url.startsWith('https://challenges.cloudflare.com/turnstile/')) {
      return route.fulfill({ contentType: 'text/javascript', body: `window.turnstile = {
        render(slot, options) { window.testSecurity = options; slot.textContent = 'Security check (simulated)'; options.callback('synthetic-turnstile-token'); return 'test-widget'; },
        reset() { window.testSecurity.callback('synthetic-turnstile-token'); }, isExpired() { return false; }
      };` });
    }
    if (url === CONFIG.submissionEndpoint + '/auth/verify') {
      requests.push({ type: 'verify', url, method: request.method(), headers: request.headers() });
      if (options.authNetworkFailure) return route.abort();
      return route.fulfill({ status: options.authStatus || 200, json: options.authPayload || { success: true, authorized: options.authStatus ? false : true } });
    }
    if (url === new URL(CONFIG.submissionEndpoint).href || url === new URL('/submit', CONFIG.resourcesEndpoint).href) {
      requests.push({ type: 'submit', url, method: request.method(), body: request.postData(), headers: request.headers() });
      if (options.holdUpload) await options.holdUpload;
      if (options.networkFailure) return route.abort();
      return route.fulfill({ status: options.uploadStatus || 201, json: options.uploadPayload || {
        success: !options.uploadStatus, ...(options.privateModeration
          ? {submission_id: '12345678-1234-4123-8123-123456789abc'}
          : {pr_url: 'https://github.com/omatek/root-archive/pull/999999'}),
        asset_url: 'https://assets.example.invalid/pending-must-not-render.pdf'
      } });
    }
    if (url.startsWith('https://assets.example.invalid/')) {
      return route.fulfill({ contentType: 'text/plain', body: 'Synthetic resource payload' });
    }
    return route.abort();
  });
  async function goto(path = '/') { await page.goto(appOrigin + path); await page.locator('#load-state').waitFor({ state: 'hidden' }); }
  async function close() { assert.deepEqual(errors, [], 'no application exceptions'); await context.close(); }
  return { context, page, requests, options, goto, close };
}
async function openContribution(page, contextual = true) {
  await page.locator(contextual ? '.empty-course [data-contribute]' : '.masthead [data-contribute]').click();
  await page.waitForFunction(() => document.getElementById('contribution-dialog').open);
}
async function fillContribution(page) {
  await page.locator('#contribution-title').fill('Synthetic study summary');
  await page.locator('#contribution-type').selectOption('Summary');
  await page.locator('#contribution-semester').fill('Fall 2026');
  await page.locator('#contribution-file').setInputFiles(pdf);
  await page.locator('#selected-file').filter({ hasText: 'synthetic.pdf' }).waitFor();
}
async function signIn(page) {
  await page.getByRole('button', { name: 'Google sign-in (simulated)' }).click();
  await page.getByText('Student account verified.', { exact: true }).waitFor();
}
async function retainedDraft(page) {
  assert.equal(await page.locator('#contribution-course').inputValue(), '0401212');
  assert.equal(await page.locator('#contribution-title').inputValue(), 'Synthetic study summary');
  assert.equal(await page.locator('#contribution-type').inputValue(), 'Summary');
  assert.equal(await page.locator('#contribution-semester').inputValue(), 'Fall 2026');
  assert.match(await page.locator('#selected-file').innerText(), /synthetic.pdf/);
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'page fits viewport');
  const bad = await page.locator('dialog[open]').evaluateAll(dialogs => dialogs.some(d => d.scrollWidth > d.clientWidth + 1));
  assert.equal(bad, false, 'dialog fits viewport');
}
async function accessible(page) {
  await page.evaluate(axeSource);
  const report = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } }));
  assert.deepEqual(report.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'automated accessibility checks');
}
async function settledNavigation(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('social crawlers receive brand metadata and a standalone image without running JavaScript', async () => {
  const s = await setup(); await s.goto();
  const title = 'root/archive — Student-built course materials';
  const description = 'Find your course. Share what helped you learn. An open resource archive built by students.';
  const image = 'https://archive.rootamman.com/assets/social/root-archive-og.png';
  assert.equal(await s.page.title(), title, 'directory rendering retains the brand-first title');
  const crawler = await browser.newContext({ javaScriptEnabled: false });
  try {
    await crawler.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await crawler.newPage();
    // Static Pages returns the same general sharing identity for course links.
    await page.goto(origin + '/?course=0401212');
    assert.equal(await page.title(), title);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://archive.rootamman.com/');
    for (const [key, expected] of Object.entries({
      'og:type': 'website', 'og:site_name': 'root/archive', 'og:title': title,
      'og:description': description, 'og:url': 'https://archive.rootamman.com/',
      'og:image': image, 'og:image:type': 'image/png', 'og:image:width': '1200', 'og:image:height': '630',
      'twitter:card': 'summary_large_image', 'twitter:title': title,
      'twitter:description': description, 'twitter:url': 'https://archive.rootamman.com/', 'twitter:image': image
    })) {
      const meta = page.locator(`head meta[${key.startsWith('og:') ? 'property' : 'name'}="${key}"]`);
      assert.equal(await meta.count(), 1, `one ${key} tag`);
      assert.equal(await meta.getAttribute('content'), expected);
    }
    const alt = await page.locator('meta[property="og:image:alt"]').getAttribute('content');
    assert.match(alt, /root\/archive/);
    assert.equal(await page.locator('meta[name="twitter:image:alt"]').getAttribute('content'), alt);
    const asset = await page.evaluate(async path => {
      document.querySelector('link[rel=stylesheet]').remove();
      const image = new Image(); image.src = path; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { width: image.naturalWidth, height: image.naturalHeight, background: [...ctx.getImageData(0, 0, 1, 1).data] };
    }, new URL(image).pathname);
    assert.deepEqual(asset, { width: 1200, height: 630, background: [38, 34, 41, 255] });
  } finally { await crawler.close(); await s.close(); }
});

test('Back/Forward saves the latest position and focus on every visited entry', async () => {
  const resources = Array.from({ length: 18 }, (_, i) => ({ ...fixture, id: `history-${i}`, type: i % 2 ? 'Practice Questions' : 'Summary' }));
  const s = await setup({ resources }); const p = s.page; await s.goto();
  await p.locator('#course-0401212').click(); await settledNavigation(p);
  await p.evaluate(() => {
    document.getElementById('resource-type-filter').focus({ preventScroll: true });
    window.scrollTo(0, 650);
    history.back();
  });
  await p.locator('.course-table').waitFor(); await settledNavigation(p);
  await p.evaluate(() => {
    document.getElementById('course-search').focus({ preventScroll: true });
    window.scrollTo(0, 900);
    history.forward();
  });
  await p.locator('#course-heading').waitFor(); await settledNavigation(p);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'resource-type-filter');
  assert(Math.abs(await p.evaluate(() => scrollY) - 650) < 3);
  // Revisit both entries and change the course position again before Back.
  await p.evaluate(() => {
    const heading = document.getElementById('course-heading');
    heading.tabIndex = -1; heading.focus({ preventScroll: true });
    window.scrollTo(0, 1100);
    history.back();
  });
  await p.locator('.course-table').waitFor(); await settledNavigation(p);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'course-search');
  assert(Math.abs(await p.evaluate(() => scrollY) - 900) < 3);
  await p.goForward(); await settledNavigation(p);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'course-heading');
  assert(Math.abs(await p.evaluate(() => scrollY) - 1100) < 3);
  await s.close();
});

test('course resource-type filters survive history, explicit return and reload without leaking between courses', async () => {
  const resources = ['0401212', '0401111'].flatMap(course_id => Array.from({ length: 14 }, (_, i) => ({
    ...fixture, course_id, id: `${course_id}-${i}`, type: i % 2 ? 'Practice Questions' : 'Summary'
  })));
  const s = await setup({ resources }); const p = s.page; await s.goto();
  await p.locator('#course-0401212').click(); await settledNavigation(p);
  await p.locator('#resource-type-filter').selectOption('Summary');
  await p.locator('a[data-about]').first().click();
  await p.goBack(); await settledNavigation(p);
  assert.equal(await p.locator('#resource-type-filter').inputValue(), 'Summary');
  assert.equal(await p.locator('.resource-open').count(), 7);
  await p.reload(); await p.locator('#resource-type-filter').waitFor(); await settledNavigation(p);
  assert.equal(await p.locator('#resource-type-filter').inputValue(), 'Summary');
  await p.locator('[data-return]').first().click(); await p.locator('.course-table').waitFor();
  await p.goForward(); await settledNavigation(p);
  assert.equal(await p.locator('#resource-type-filter').inputValue(), 'Summary');
  await p.goBack(); await p.locator('.course-table').waitFor();
  await p.locator('#course-0401111').click(); await settledNavigation(p);
  assert.equal(await p.locator('#resource-type-filter').inputValue(), '');
  assert.equal(await p.locator('.resource-open').count(), 14);
  assert.equal(new URL(p.url()).searchParams.get('course'), '0401111');
  await s.close();
});

test('/ from a course or About keeps search focused across rendering and accepts typing immediately', async () => {
  const s = await setup(); const p = s.page;
  for (const path of ['/?course=0401212', '/?view=about']) {
    await s.goto(path);
    await p.keyboard.press('/');
    await p.keyboard.type('data');
    await settledNavigation(p);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'course-search');
    assert.equal(await p.locator('#course-search').inputValue(), 'data');
    assert.equal(new URL(p.url()).searchParams.get('q'), 'data');
    await p.keyboard.type(' structures');
    assert.equal(await p.locator('#course-search').inputValue(), 'data structures');
    assert.equal(await p.locator('.course-name a').count(), 1);
  }
  await s.close();
});

test('both hosted frontends keep shareable course URLs and construct the expected authenticated API requests (mocked services)', async () => {
  assert.equal(CONFIG.submissionEndpoint, 'https://api.rootamman.com');
  for (const frontendOrigin of ['https://archive.rootamman.com', 'https://root-archive.pages.dev']) {
    const s = await setup({ frontendOrigin }); const p = s.page;
    await s.goto('/?course=0401212&q=data&track=CS');
    await p.reload(); await p.locator('#course-heading').waitFor();
    assert.equal(p.url(), frontendOrigin + '/?course=0401212&q=data&track=CS');
    assert.match(await p.title(), /Data Structures \(0401212\)/);
    await openContribution(p); await fillContribution(p); await signIn(p);
    await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
    assert.deepEqual(s.requests.map(({type, url, method}) => ({type, url, method})), [
      {type: 'verify', url: 'https://api.rootamman.com/auth/verify', method: 'POST'},
      {type: 'submit', url: 'https://api.rootamman.com/', method: 'POST'}
    ]);
    assert(s.requests.every(request => request.headers.authorization === `Bearer ${fakeCredential}`));
    const submission = s.requests.find(request => request.type === 'submit');
    for (const field of ['course_id', 'type', 'title', 'semester', 'file', 'turnstile_token']) {
      assert(submission.body.includes(`name="${field}"`));
    }
    assert(submission.body.includes('synthetic-turnstile-token'));
    assert(submission.body.includes('0401212'));
    await s.close();
  }
});

 test('directory query/filter/scroll/focus survive course navigation, Back and Forward', async () => {
  const s = await setup(); const p = s.page; await s.goto();
  assert.equal(await p.locator('.course-table tbody tr').count(), realCourses.length);
  await p.locator('#course-search').fill('a'); await p.locator('[data-track=CS]').click();
  const target = p.locator('.course-name a').nth(14);
  const id = await target.getAttribute('id'); await target.scrollIntoViewIfNeeded();
  const scroll = await p.evaluate(() => scrollY); assert(scroll > 100);
  await target.click(); await p.locator('#course-heading').waitFor();
  assert.match(p.url(), /course=/); assert.equal(await p.locator('#directory-view').isVisible(), false);
  await p.goBack(); await p.locator('.course-table').waitFor();
  await p.waitForFunction(id => document.activeElement.id === id, id);
  assert.equal(await p.locator('#course-search').inputValue(), 'a');
  assert.equal(await p.locator('[data-track=CS]').getAttribute('aria-pressed'), 'true');
  assert(Math.abs(await p.evaluate(() => scrollY) - scroll) < 3);
  await p.goForward(); await p.locator('#course-heading').waitFor();
  await p.locator('[data-return]').first().click(); await p.locator('.course-table').waitFor();
  assert.equal(await p.locator('#course-search').inputValue(), 'a');
  await p.locator('#course-search').fill('no course matches this');
  await p.getByRole('heading', { name: 'No matching courses.' }).waitFor();
  await p.getByRole('button', { name: 'Clear search and filters' }).click();
  assert.equal(await p.locator('.course-table tbody tr').count(), realCourses.length);
  await s.close();
});

test('direct URLs reload, links open in a second tab, titles and unknown courses work', async () => {
  const s = await setup(); const p = s.page; await s.goto('/?course=0401212&q=data&track=CS');
  assert.match(await p.title(), /Data Structures \(0401212\)/);
  await p.reload(); await p.getByRole('heading', { name: 'Data Structures', exact: true }).waitFor();
  await p.locator('[data-return]').first().click(); await p.locator('.course-table').waitFor();
  assert.equal(await p.locator('#course-search').inputValue(), 'data');
  const href = await p.locator('#course-0401212').getAttribute('href');
  const other = await s.context.newPage(); await other.goto(origin + href);
  await other.getByRole('heading', { name: 'Data Structures', exact: true }).waitFor();
  assert.equal(await p.locator('#directory-view').isVisible(), true);
  await other.close(); await s.goto('/?course=9999999');
  await p.getByRole('heading', { name: 'Course not found.' }).waitFor();
  await s.close();
});

test('published resources use real metadata and safe direct links; larger collections filter', async () => {
  const resources = Array.from({ length: 14 }, (_, i) => ({ ...fixture, id: `synthetic-${i}`, type: i % 2 ? 'Practice Questions' : 'Summary', title: i === 0 ? 'x'.repeat(120) : `Synthetic resource ${i}` }));
  const s = await setup({ resources }); const p = s.page; await s.goto('/?course=0401212');
  assert.equal(await p.locator('.resource-open').count(), 14);
  assert.equal(await p.locator('.resource-open').first().getAttribute('target'), '_blank');
  assert.equal(await p.locator('.resource-open').first().getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await p.locator('.resource-open').first().getAttribute('href'), fixture.asset_url);
  const opened = s.context.waitForEvent('page');
  await p.locator('.resource-open').first().click();
  const resourceTab = await opened; await resourceTab.waitForLoadState();
  assert.equal(resourceTab.url(), fixture.asset_url);
  assert.match(await resourceTab.locator('body').innerText(), /Synthetic resource payload/);
  assert.equal(s.requests.length, 0, 'opening materials is public');
  await resourceTab.close();
  await p.locator('#resource-type-filter').selectOption('Summary');
  assert.equal(await p.locator('.resource-open').count(), 7);
  for (const width of [320, 768, 1440]) { await p.setViewportSize({ width, height: 900 }); await noOverflow(p); }
  await accessible(p); await s.close();
});

test('catalog errors can retry and malformed resources never become visible', async () => {
  const s = await setup({ failLoad: true }); await s.goto();
  assert.equal(await s.page.locator('#load-error').isVisible(), true);
  s.options.failLoad = false; await s.page.locator('#retry-load').click(); await s.page.locator('.course-table').waitFor();
  s.options.resources = [{ ...fixture, asset_url: 'javascript:alert(1)' }]; await s.goto();
  assert.equal(await s.page.locator('#load-error').isVisible(), true);
  assert.equal(await s.page.locator('.resource-open').count(), 0); await s.close();
});

test('private catalog API preserves navigation and filters with no static fallback (mocked API)', async () => {
  const resources = Array.from({length: 14}, (_, i) => {
    const id = `12345678-1234-4123-8123-${String(i + 1).padStart(12, '0')}`;
    return {...fixture, id, type: i % 2 ? 'Notes' : 'Summary', semester: i ? 'Fall 2026' : '',
      asset_url: `https://api.rootamman.com/download/${id}`};
  });
  const s = await setup({privateModeration: true, staticResources: [fixture], apiPages: [
    {resources: resources.slice(0, 7), next_cursor: '1'}, {resources: resources.slice(7), next_cursor: null}
  ]}); const p = s.page;
  try {
    await s.goto('/?hasMaterials=1&track=CS&q=synthetic');
    assert.equal(await p.locator('.course-name a').count(), 1);
    assert.equal(s.requests.filter(r => r.type === 'resources').length, 2);
    assert.equal(s.requests.filter(r => r.type === 'static-resources').length, 0);
    assert.equal(s.requests.filter(r => ['verify', 'submit'].includes(r.type)).length, 0);
    const directoryUrl = p.url();
    await p.locator('#course-0401212').click(); await p.locator('#course-heading').waitFor();
    assert.equal(await p.locator('.resource-open').count(), 14);
    assert.equal(await p.locator('.resource-open').first().getAttribute('href'), resources[0].asset_url);
    await p.locator('#resource-type-filter').selectOption('Notes');
    assert.equal(await p.locator('.resource-open').count(), 7);
    await p.goBack(); await p.locator('.course-table').waitFor(); await settledNavigation(p);
    assert.equal(p.url(), directoryUrl);
    assert.equal(await p.locator('#has-materials').isChecked(), true);
    await p.goForward(); await p.locator('#resource-heading, #course-heading').first().waitFor();
    assert.equal(await p.locator('#resource-type-filter').inputValue(), 'Notes');
    for (const width of [320, 1440]) { await p.setViewportSize({width, height: 900}); await noOverflow(p); }
    await accessible(p);
    s.options.apiPages = [{resources: [], next_cursor: null}];
    await s.goto('/?hasMaterials=1');
    assert.equal(await p.locator('.course-name a').count(), 0, 'old static data cannot revive removed resources');
    assert.match(await p.locator('#directory-results').innerText(), /No matching courses/);
  } finally { await s.close(); }
});

test('private resource API failure offers retry without claiming an empty catalog (mocked API)', async () => {
  const s = await setup({privateModeration: true, resourceApiFailure: true, staticResources: [fixture]});
  try {
    await s.goto('/?course=0401212');
    assert.equal(await s.page.locator('#load-error').isVisible(), true);
    assert.equal(await s.page.getByText('No resources published yet.', {exact: true}).count(), 0);
    assert.equal(await s.page.locator('.resource-open').count(), 0);
    assert.equal(s.requests.filter(r => r.type === 'static-resources').length, 0);
    s.options.resourceApiFailure = false;
    await s.page.locator('#retry-load').click();
    await s.page.getByText('No resources published yet.', {exact: true}).waitFor();
    assert.equal(await s.page.locator('#load-error').isVisible(), false);
  } finally { await s.close(); }
});

test('F-02 a concurrent catalog change restarts paging and renders only a coherent generation',async()=>{
  const resource=n=>{const id=`12345678-1234-4123-8123-${String(n).padStart(12,'0')}`;
    return {...fixture,id,asset_url:`https://api.rootamman.com/download/${id}`};};
  const stale=Array.from({length:201},(_,i)=>resource(i+1));
  // Publication plus withdrawal before the old offset: the old first page must
  // be discarded, rather than deduplicated and joined to the new last page.
  const live=[resource(202),...stale.slice(1)];
  const s=await setup({privateModeration:true,apiPages:[{resources:stale.slice(0,200),next_cursor:'old_page'},
    {resources:stale.slice(200),next_cursor:null}],changeCatalog:[{resources:live.slice(0,200),next_cursor:'new_page'},
    {resources:live.slice(200),next_cursor:null}]});
  try{
    await s.goto('/?course=0401212');await s.page.locator('#course-heading').waitFor();
    assert.equal(await s.page.locator('#load-error').isVisible(),false);
    const links=await s.page.locator('.resource-open').evaluateAll(nodes=>nodes.map(n=>n.href));
    assert.deepEqual(new Set(links),new Set(live.map(r=>r.asset_url)));assert.equal(links.length,201);
    assert.equal(s.requests.filter(r=>r.type==='resources').length,4);
    assert.equal(s.requests.filter(r=>r.type==='static-resources').length,0);
  }finally{await s.close();}
});

test('private submission keeps drafts, opts into credit and confirms only a reference (mocked Google and Worker)', async () => {
  const s = await setup({privateModeration: true, uploadStatus: 401}); const p = s.page;
  try {
    await s.goto('/?course=0401212'); await openContribution(p); await fillContribution(p);
    await p.locator('#contribution-semester').fill('');
    assert.match(await p.locator('#contribution-notice').innerText(), /private until approved/);
    assert.match(await p.locator('#contribution-notice').innerText(), /format, rotate, crop or redact/);
    assert.equal(await p.locator('#contribution-contributor').isDisabled(), true);
    await signIn(p); await p.locator('#submit-resource').click();
    await p.locator('#submission-message').filter({hasText: /verified again/}).waitFor();
    assert.equal(await p.locator('#contribution-title').inputValue(), 'Synthetic study summary');
    assert.match(await p.locator('#selected-file').innerText(), /synthetic.pdf/);
    s.options.uploadStatus = 0;
    await signIn(p); await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
    assert.equal(await p.locator('#submission-reference').innerText(), 'Submission reference: 12345678-1234-4123-8123-123456789abc');
    assert.equal(await p.locator('#contribution-success a').count(), 0);
    assert.doesNotMatch(await p.locator('#contribution-success').innerText(), /github|pending-must-not-render|email|notification|track status/i);
    await p.setViewportSize({width: 320, height: 800}); await noOverflow(p);
    let uploads = s.requests.filter(r => r.type === 'submit');
    assert(uploads.every(r => !r.body.includes('name="contributor"')), 'credit is absent by default');
    assert(uploads.every(r => r.url.endsWith('/submit')));
    await p.locator('#contribute-another').click();
    await noOverflow(p);
    await p.locator('#contribution-course').selectOption('0401212'); await fillContribution(p);
    await p.locator('#contribution-credit').check();
    await p.locator('#contribution-contributor').fill('Chosen public name');
    await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
    uploads = s.requests.filter(r => r.type === 'submit');
    assert(uploads.at(-1).body.includes('Chosen public name'));
    await p.locator('#contribute-another').click();
    assert.equal(await p.locator('#contribution-credit').isChecked(), false);
    assert.equal(await p.locator('#contribution-contributor').isDisabled(), true);
    await accessible(p);
  } finally { await s.close(); }
});

test('private security-check and malformed-reference failures keep drafts and reveal no private links (mocked Worker)', async () => {
  const s = await setup({privateModeration: true, uploadStatus: 403,
    uploadPayload: {success: false, error: 'Turnstile verification failed.'}}); const p = s.page;
  try {
    await s.goto('/?course=0401212'); await openContribution(p); await fillContribution(p); await signIn(p);
    await p.locator('#submit-resource').click();
    await p.locator('#submission-message').filter({hasText: /security check was not accepted/}).waitFor();
    assert.equal(await p.locator('#signout').isVisible(), true, 'Turnstile rejection does not sign out an eligible student');
    assert.equal(await p.locator('#contribution-title').inputValue(), 'Synthetic study summary');
    s.options.uploadStatus = 0;
    s.options.uploadPayload = {success: true, submission_id: 'https://private.invalid/file',
      pr_url: 'https://github.com/omatek/root-archive/pull/1', asset_url: 'https://private.invalid/file'};
    await p.locator('#submit-resource').click();
    await p.locator('#submission-message').filter({hasText: /valid submission reference/}).waitFor();
    assert.equal(await p.locator('#contribution-success').isVisible(), false);
    assert.doesNotMatch(await p.locator('#submission-status').innerText(), /private.invalid|github.com/);
    assert.match(await p.locator('#selected-file').innerText(), /synthetic.pdf/);
  } finally { await s.close(); }
});

test('materials checkbox stays compact and beside its clickable label on desktop and mobile, including stale CSS caches', async () => {
  const s = await setup({staleStylesheet: true}); const p = s.page;
  try {
    for (const width of [1440, 390, 320]) {
      await p.setViewportSize({width, height: 900}); await s.goto();
      await p.evaluate(() => document.fonts.ready);
      const checkbox = p.getByRole('checkbox', {name: 'Only courses with materials'});
      const geometry = await checkbox.evaluate(input => {
        const label = input.labels[0];
        const text = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        const range = document.createRange(); range.selectNodeContents(text);
        const box = input.getBoundingClientRect(), caption = range.getBoundingClientRect();
        return {width: box.width, height: box.height, gap: caption.left - box.right,
          centerDifference: Math.abs((box.top + box.bottom - caption.top - caption.bottom) / 2)};
      });
      assert(geometry.width >= 14 && geometry.width <= 22, `${width}px viewport: compact checkbox width (${geometry.width})`);
      assert(geometry.height >= 14 && geometry.height <= 22, `${width}px viewport: compact checkbox height (${geometry.height})`);
      assert(geometry.gap >= 4 && geometry.gap <= 20, `${width}px viewport: label immediately to the right`);
      assert(geometry.centerDifference <= 3, `${width}px viewport: checkbox and text horizontally aligned`);
      await checkbox.focus(); await p.keyboard.press('Space'); await settledNavigation(p);
      assert.equal(await checkbox.isChecked(), true);
      assert.equal(new URL(p.url()).searchParams.get('hasMaterials'), '1');
      const focus = await checkbox.evaluate(input => ({visible: input.matches(':focus-visible'), outline: getComputedStyle(input).outlineStyle}));
      assert.equal(focus.visible, true); assert.notEqual(focus.outline, 'none');
      // Click the text side of the wrapping label, away from the checkbox.
      await p.locator('.materials-filter').click({position: {x: 100, y: 22}});
      assert.equal(await checkbox.isChecked(), false);
      await noOverflow(p);
    }
    // A checkbox must not depend on one component's override to escape text-field sizing.
    const nativeSize = await p.evaluate(() => {
      const wrapper = document.createElement('div');
      const input = document.createElement('input'); input.type = 'checkbox';
      wrapper.append(input); document.body.append(wrapper);
      const box = input.getBoundingClientRect(); wrapper.remove();
      return {width: box.width, height: box.height};
    });
    assert(nativeSize.width <= 22 && nativeSize.height <= 22, 'global full-width field styles exclude checkboxes');
  } finally { await s.close(); }
});

test('materials-only filter intersects search/track and survives course, About, reload and history', async () => {
  const courses = realCourses.map(c => ['0401212', '0401111'].includes(c.id) ? {...c, tracks: ['CS']} : c);
  const s = await setup({ courses, resources: [fixture, {...fixture, id: 'second', course_id: '0401111'}] });
  const p = s.page; await s.goto();
  const checkbox = p.getByRole('checkbox', {name: 'Only courses with materials'});
  assert.equal(await checkbox.isChecked(), false);
  await checkbox.focus(); await p.keyboard.press('Space');
  await settledNavigation(p);
  assert.equal(new URL(p.url()).searchParams.get('hasMaterials'), '1');
  assert.equal(await p.locator('.course-name a').count(), 2);
  await p.locator('#course-search').fill('synthetic');
  await p.locator('[data-track=CS]').click();
  assert.equal(await p.locator('.course-name a').count(), 2);
  await p.locator('[data-track=Cybersecurity]').click();
  await p.getByRole('heading', {name: 'No matching courses.'}).waitFor();
  assert.match(await p.locator('#directory-results').innerText(), /Turn off “Only courses with materials”/);
  await p.locator('[data-track=CS]').click();
  await p.locator('#course-search').fill('data');
  assert.equal(await p.locator('.course-name a').count(), 1);
  const directoryUrl = p.url();
  const courseHref = await p.locator('#course-0401212').getAttribute('href');
  assert.match(courseHref, /hasMaterials=1/);
  await p.locator('#course-0401212').click(); await settledNavigation(p);
  await p.reload(); await p.locator('#course-heading').waitFor();
  assert.equal(new URL(p.url()).searchParams.get('hasMaterials'), '1');
  await p.goBack(); await p.locator('.course-table').waitFor(); await settledNavigation(p);
  assert.equal(p.url(), directoryUrl);
  assert.equal(await checkbox.isChecked(), true);
  await p.goForward(); await p.locator('#course-heading').waitFor();
  await p.locator('a[data-about]').first().click(); await p.locator('#about-view').waitFor();
  assert.equal(new URL(p.url()).searchParams.get('hasMaterials'), '1');
  await p.reload(); await p.locator('#about-view').waitFor();
  await p.locator('#about-view [data-return]').click(); await p.locator('.course-table').waitFor();
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(await p.locator('#course-search').inputValue(), 'data');
  assert.equal(await p.locator('[data-track=CS]').getAttribute('aria-pressed'), 'true');
  await p.reload(); await p.locator('.course-table').waitFor();
  assert.equal(await checkbox.isChecked(), true);
  await checkbox.uncheck();
  await settledNavigation(p);
  assert.equal(new URL(p.url()).searchParams.has('hasMaterials'), false);
  await p.goBack(); await p.locator('#about-view').waitFor();
  await p.goForward(); await p.locator('.course-table').waitFor();
  assert.equal(await checkbox.isChecked(), false);
  await accessible(p); await s.close();
});

test('materials-only empty catalog and duplicate/invalid URLs stay usable and never count pending uploads', async () => {
  const s = await setup({resources: []}); const p = s.page;
  for (const [query, checked] of [['1', true], ['0', false], ['true', false], ['1&hasMaterials=0', true],
    ['0&hasMaterials=1', false], ['bad&hasMaterials=1', false], ['1&hasMaterials=1', true]]) {
    await s.goto('/?hasMaterials=' + query);
    assert.equal(await p.locator('#has-materials').isChecked(), checked);
    assert.equal(await p.locator('.course-name a').count(), checked ? 0 : realCourses.length);
    await p.locator('#course-search').fill('data');
    await settledNavigation(p);
    assert.deepEqual(new URL(p.url()).searchParams.getAll('hasMaterials'), checked ? ['1'] : []);
  }
  await accessible(p);
  await p.getByRole('button', {name: 'Clear search and filters'}).click();
  assert.equal(await p.locator('#has-materials').isChecked(), false);
  assert.equal(await p.locator('.course-name a').count(), realCourses.length);
  await s.goto('/?course=0401212&hasMaterials=1');
  await openContribution(p); await fillContribution(p); await signIn(p);
  await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
  await p.locator('#close-contribution').click();
  await p.locator('[data-directory]').click();
  await p.getByRole('heading', {name: 'No matching courses.'}).waitFor();
  assert.equal(await p.locator('.course-name a').count(), 0, 'a pending success is not published data');
  await s.close();
});

test('five resource categories render, filter and submit with consistent names (mocked services)', async () => {
  const resources = Array.from({length: 15}, (_, i) => ({...fixture, id: `type-${i}`, type: TYPES[i % TYPES.length]}));
  const s = await setup({resources}); const p = s.page;
  await s.goto('/?course=0401212');
  assert.deepEqual(await p.locator('.resource-group h3').allTextContents(), [
    'Practice Questions · 3', 'Summaries · 3', 'Notes · 3', 'Test Banks · 3', 'Other resources · 3'
  ]);
  assert.deepEqual(await p.locator('#resource-type-filter option').allTextContents(), ['All resource types', ...TYPES]);
  for (const type of TYPES) {
    await p.locator('#resource-type-filter').selectOption(type);
    assert.equal(await p.locator('.resource-open').count(), 3);
    assert((await p.locator('.resource-meta').allTextContents()).every(text => text.startsWith(type + ' ·')));
  }
  await accessible(p);
  await openContribution(p, false);
  assert.deepEqual(await p.locator('#contribution-type option').allTextContents(), ['Choose a type', ...TYPES]);
  await p.locator('#contribution-course').selectOption('0401212');
  await fillContribution(p); await signIn(p);
  for (const type of TYPES) {
    await p.locator('#contribution-type').selectOption(type);
    await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
    const upload = s.requests.filter(r => r.type === 'submit').at(-1);
    assert(upload.body.includes(`name="type"\r\n\r\n${type}\r\n`));
    if (type !== TYPES.at(-1)) {
      await p.locator('#contribute-another').click();
      await p.locator('#contribution-course').selectOption('0401212'); await fillContribution(p);
    }
  }
  await s.close();
});

test('About introduces root and initial academic coverage while preserving identity and public access', async () => {
  const s = await setup(); const p = s.page; await s.goto();
  assert.equal(await p.locator('#directory-heading').innerText(), 'Course directory');
  await p.locator('a[data-about]').first().click(); await p.locator('#about-view').waitFor();
  const text = await p.locator('#about-view').innerText();
  for (const phrase of ['independent, student-led engineering and IT community in Jordan', 'collaborative projects',
    'workshops', 'experimentation', 'competitions', 'A little less starting from scratch.',
    'root/archive is our first public project', 'Computer Science, Artificial Intelligence, and Cybersecurity at AUM',
    'Anyone can browse and download', 'eligible student account', 'every submission is reviewed',
    'Practice questions, summaries, notes, test banks', 'not official university services']) assert(text.includes(phrase), phrase);
  assert(!/past paper|AUM’s archive|AUM's archive/i.test(text));
  assert.equal(await p.locator('.parent-mark').getAttribute('src'), './assets/brand/root.svg');
  for (const width of [320, 768, 1440]) { await p.setViewportSize({width, height: 900}); await noOverflow(p); }
  await accessible(p); await s.close();
});

test('global course picker, contextual defaults, draft retention and keyboard dialog behavior', async () => {
  const s = await setup({ externalFailure: true }); const p = s.page; await s.goto('/?course=0401212');
  assert.equal(s.requests.length, 0, 'browsing does not authenticate');
  await openContribution(p); assert.equal(await p.locator('#contribution-course').inputValue(), '0401212');
  await p.locator('#contribution-title').fill('A retained draft');
  await p.keyboard.press('Escape'); assert.equal(await p.locator('dialog').evaluate(d => d.open), false);
  assert.equal(await p.evaluate(() => document.activeElement.matches('.empty-course button')), true);
  await openContribution(p, false); assert.equal(await p.locator('#contribution-title').inputValue(), 'A retained draft');
  await p.locator('#discard-draft').click(); assert.equal(await p.locator('#contribution-title').inputValue(), '');
  await p.locator('#course-picker-search').fill('data structures');
  await p.locator('#contribution-course').selectOption('0401212');
  await p.locator('#course-picker-search').fill('no such course');
  assert.equal(await p.locator('#contribution-course').inputValue(), '0401212');
  await p.locator('#close-contribution').focus(); await p.keyboard.press('Shift+Tab');
  assert.equal(await p.evaluate(() => document.getElementById('contribution-dialog').contains(document.activeElement)), true);
  await p.keyboard.press('Escape'); await openContribution(p, false);
  await accessible(p); await s.close();
});

test('auth verification preserves course/file/details; 403 and forged authorized=false never upload', async () => {
  const s = await setup({ authStatus: 403 }); const p = s.page; await s.goto('/?course=0401212');
  await openContribution(p); await fillContribution(p);
  await p.getByRole('button', { name: 'Google sign-in (simulated)' }).click();
  await p.getByText(/This account isn’t currently eligible/).waitFor();
  await p.locator('#submit-resource').click(); assert.equal(s.requests.filter(r => r.type === 'submit').length, 0);
  assert.equal(await p.locator('#contribution-course').inputValue(), '0401212');
  s.options.authStatus = 0; s.options.authPayload = { success: true, authorized: false };
  await p.getByRole('button', { name: 'Google sign-in (simulated)' }).click();
  await p.getByText(/We couldn’t verify this sign-in/).waitFor();
  s.options.authPayload = { success: true, authorized: true }; await signIn(p);
  assert.equal(await p.locator('#contribution-title').inputValue(), 'Synthetic study summary');
  assert.match(await p.locator('#selected-file').innerText(), /synthetic.pdf/);
  const stores = await p.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage), location.href]);
  assert(stores.every(text => !text.includes('synthetic.')));
  await s.close();
});

test('Google chooser has no domain hint; rejected accounts can switch and submit their complete draft', async () => {
  const s = await setup({authStatus: 403}); const p = s.page;
  await s.goto('/?course=0401212'); await openContribution(p); await fillContribution(p);
  await p.locator('#contribution-contributor').fill('Synthetic contributor');
  assert.equal(await p.locator('#auth-heading').innerText(), 'Sign in to contribute.');
  await p.waitForFunction(() => !!window.testIdentity);
  assert.equal(await p.evaluate(() => Object.hasOwn(window.testIdentity, 'hd')), false);
  assert.equal(await p.evaluate(() => window.testIdentity.auto_select), false);
  await p.getByRole('button', {name: 'Google sign-in (simulated)'}).click();
  await p.locator('#auth-message').filter({hasText: /isn’t currently eligible/}).waitFor();
  assert.equal(await p.locator('#auth-message').getAttribute('role'), 'status');
  await retainedDraft(p); await accessible(p);
  await p.locator('#submit-resource').click();
  assert.match(await p.locator('#auth-message').innerText(), /isn’t currently eligible/);
  assert.equal(s.requests.filter(r => r.type === 'submit').length, 0);
  await p.getByRole('button', {name: 'Use a different Google account'}).click();
  assert.equal(await p.evaluate(() => document.activeElement.textContent), 'Google sign-in (simulated)');
  const switched = fakeCredential + '-another-account';
  await p.evaluate(value => {window.testCredential = value;}, switched);
  s.options.authStatus = 0;
  await signIn(p); await retainedDraft(p);
  assert.equal(await p.locator('#contribution-contributor').inputValue(), 'Synthetic contributor');
  await p.getByRole('button', {name: 'Sign out', exact: true}).click();
  assert.match(await p.locator('#auth-message').innerText(), /signed out/);
  await retainedDraft(p);
  await p.locator('#submit-resource').click();
  assert.equal(s.requests.filter(r => r.type === 'submit').length, 0);
  await signIn(p); await retainedDraft(p);
  assert(await p.evaluate(() => window.testAutoSelectDisabled > 0));
  assert.deepEqual(await p.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage), document.cookie]), [[], [], '']);
  await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
  assert.equal(s.requests.filter(r => r.type === 'submit')[0].headers.authorization, `Bearer ${switched}`);
  await s.close();
});

test('late verification responses cannot restore a signed-out account or override a repeated sign-in', async () => {
  const s = await setup(); const p = s.page;
  await s.goto('/?course=0401212'); await openContribution(p); await fillContribution(p); await signIn(p);
  // Hold the browser fetch promise after its mocked response arrives, so an obsolete
  // success reaches the application even when its AbortController was cancelled.
  await p.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const result = await original(...args);
      if (String(args[0]).endsWith('/auth/verify') && window.testHoldVerification) {
        await new Promise(resolve => {window.testReleaseVerification = resolve;});
      }
      return result;
    };
  });
  for (const replacement of [false, true]) {
    await p.evaluate(() => {window.testHoldVerification = true;});
    await p.evaluate(credential => { window.testIdentity.callback({credential}); }, fakeCredential + '-stale');
    await p.waitForFunction(() => typeof window.testReleaseVerification === 'function');
    await p.locator('#switch-account').click();
    await retainedDraft(p);
    await p.evaluate(() => {window.testHoldVerification = false;});
    if (replacement) await signIn(p);
    await p.evaluate(() => {window.testReleaseVerification(); delete window.testReleaseVerification;});
    await settledNavigation(p);
    assert.equal(await p.locator('#signout').isVisible(), replacement);
    assert.equal(await p.locator('#google-signin-slot').isVisible(), !replacement);
  }
  await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
  assert.equal(s.requests.filter(r => r.type === 'submit')[0].headers.authorization, `Bearer ${fakeCredential}`);
  await s.close();
});

test('verification failure retries and token expiration retain the draft across close/reopen', async () => {
  const s = await setup({authStatus: 503, externalFailure: true}); const p = s.page;
  await s.goto('/?course=0401212'); await openContribution(p); await fillContribution(p);
  await p.locator('#auth-message').filter({hasText: /Google sign-in couldn’t load/}).waitFor();
  await retainedDraft(p);
  s.options.externalFailure = false;
  await p.locator('#retry-signin').click();
  await p.getByRole('button', {name: 'Google sign-in (simulated)'}).click();
  await p.locator('#auth-message').filter({hasText: /couldn’t verify/}).waitFor();
  await retainedDraft(p);
  s.options.authNetworkFailure = true;
  await p.getByRole('button', {name: 'Google sign-in (simulated)'}).click();
  await p.locator('#auth-message').filter({hasText: /couldn’t reach account verification/}).waitFor();
  await retainedDraft(p);
  s.options.authNetworkFailure = false;
  s.options.authStatus = 0; await signIn(p);
  await p.locator('#save-close').click();
  const now = Date.now();
  await p.clock.install({time: now});
  await p.clock.fastForward(3600 * 1000);
  await openContribution(p); // init also checks expiry after suspension/backgrounding.
  await p.locator('#auth-message').filter({hasText: /expired/}).waitFor();
  assert.equal(await p.locator('#signout').isVisible(), false);
  await retainedDraft(p);
  await p.clock.setSystemTime(now);
  await signIn(p); await retainedDraft(p);
  await s.close();
});

test('validation, Turnstile expiry and expired sign-in prevent submission with useful feedback', async () => {
  const s = await setup(); const p = s.page; await s.goto('/?course=0401212'); await openContribution(p);
  await p.locator('#submit-resource').click(); assert.equal(await p.locator('#contribution-title').getAttribute('aria-invalid'), 'true');
  assert.equal(await p.locator('#contribution-title').evaluate(e => document.activeElement === e), true);
  await p.locator('#contribution-file').setInputFiles({ name: 'false.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await p.locator('#file-error').filter({ hasText: /does not appear/ }).waitFor();
  await fillContribution(p); await signIn(p);
  await p.evaluate(() => window.testSecurity['expired-callback']()); await p.locator('#submit-resource').click();
  assert.equal(s.requests.filter(r => r.type === 'submit').length, 0);
  assert.equal(await p.locator('#turnstile-error').isVisible(), true);
  await p.locator('#retry-security').click();
  const expired = `synthetic.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`;
  await p.evaluate(credential => window.testIdentity.callback({ credential }), expired);
  await p.locator('#auth-message').filter({hasText: /expired/}).waitFor();
  await p.locator('#submit-resource').click(); assert.equal(s.requests.filter(r => r.type === 'submit').length, 0);
  assert.equal(await p.locator('#contribution-title').inputValue(), 'Synthetic study summary'); await s.close();
});

test('upload failures preserve the draft, success shows only a review link, duplicate clicks are locked', async () => {
  let release;
  const holdUpload = new Promise(resolve => { release = resolve; });
  const s = await setup({ uploadStatus: 500, holdUpload }); const p = s.page;
  await s.goto('/?course=0401212'); await openContribution(p); await fillContribution(p); await signIn(p);
  await p.locator('#contribution-contributor').fill('Test contributor');
  await p.locator('#submit-resource').click(); await p.waitForFunction(() => document.getElementById('submit-resource').disabled);
  assert.equal(await p.locator('#close-contribution').isDisabled(), true);
  await p.keyboard.press('Escape'); assert.equal(await p.locator('dialog').evaluate(d => d.open), true);
  release(); await p.waitForFunction(() => !document.getElementById('submit-resource').disabled);
  assert.match(await p.locator('#submission-message').innerText(), /couldn’t confirm whether/);
  assert.equal(await p.locator('#contribution-title').inputValue(), 'Synthetic study summary');
  s.options.uploadStatus = 0;
  await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
  const uploads = s.requests.filter(r => r.type === 'submit'); assert.equal(uploads.length, 2);
  assert.equal(uploads[1].headers.authorization, `Bearer ${fakeCredential}`);
  for (const field of ['course_id','type','title','semester','contributor','file','turnstile_token']) assert(uploads[1].body.includes(`name="${field}"`));
  assert(uploads[1].body.includes('0401212'));
  assert.equal(await p.locator('#review-link a').getAttribute('href'), 'https://github.com/omatek/root-archive/pull/999999');
  assert.equal(await p.getByText(/pending-must-not-render/).count(), 0);
  assert.equal(await p.locator('a[href*="pending-must-not-render"]').count(), 0);
  assert.equal(await p.locator('#contribution-form').isVisible(), false);
  await accessible(p); await s.close();
});

test('320–1440px layouts, long content, zoom-equivalent reflow, reduced motion and accessibility', async () => {
  const courses = realCourses.map(c => c.id === '0401212' ? { ...c, name: 'A'.repeat(160) } : c);
  const s = await setup({ courses }); const p = s.page;
  for (const width of [320,375,390,430,768,1024,1440]) {
    await p.setViewportSize({ width, height: 900 }); await s.goto(); await noOverflow(p);
    await s.goto('/?course=0401212'); await noOverflow(p);
    await openContribution(p); await noOverflow(p); await p.keyboard.press('Escape');
  }
  await p.setViewportSize({ width: 320, height: 720 }); // 1280px viewport at 400% browser zoom.
  await s.goto(); await accessible(p); await s.goto('/?course=0401212'); await accessible(p);
  await openContribution(p);
  await p.locator('#contribution-file').setInputFiles({ ...pdf, name: 'long-filename-'.repeat(14) + '.pdf' });
  await p.locator('#selected-file').filter({ hasText: 'long-filename' }).waitFor();
  await noOverflow(p); await accessible(p); await p.keyboard.press('Escape');
  await s.goto('/?view=about'); await noOverflow(p); await accessible(p);
  assert.equal(await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  await s.close();
});

test('submission rejection, network and malformed-success paths keep drafts and never expose assets', async () => {
  const cases = [
    [{ uploadStatus: 401 }, /verified again/], [{ uploadStatus: 403 }, /verified again/],
    [{ uploadStatus: 413 }, /too large/], [{ uploadStatus: 429 }, /Too many requests/],
    [{ uploadStatus: 400 }, /wasn’t accepted/], [{ networkFailure: true }, /connection was interrupted/],
    [{ uploadPayload: { success: true, pr_url: 'https://untrusted.example.invalid/pull/1' } }, /valid review link/]
  ];
  for (const [options, message] of cases) {
    const s = await setup(options); const p = s.page;
    await s.goto('/?course=0401212'); await openContribution(p); await fillContribution(p); await signIn(p);
    await p.locator('#submit-resource').click();
    await p.locator('#submission-message').filter({ hasText: message }).waitFor();
    assert.equal(await p.locator('#contribution-course').inputValue(), '0401212');
    assert.equal(await p.locator('#contribution-title').inputValue(), 'Synthetic study summary');
    assert.equal(await p.locator('#contribution-success').isVisible(), false);
    assert.equal(s.requests.filter(r => r.type === 'submit').length, 1);
    if ([401, 403].includes(options.uploadStatus)) {
      await retainedDraft(p); s.options.uploadStatus = 0;
      await signIn(p);
      await p.locator('#submit-resource').click(); await p.locator('#contribution-success').waitFor();
      assert.equal(s.requests.filter(r => r.type === 'submit').length, 2);
    }
    await s.close();
  }
});

test('capture review screenshots with the real empty catalog and supplied SVG variants', async () => {
  const s = await setup(); const p = s.page;
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) { await s.close(); return; }
  await mkdir(dir, { recursive: true });
  for (const [name, width, height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,800],['tablet',768,1024]]) {
    await p.setViewportSize({ width, height }); await s.goto(); await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: resolve(dir,`directory-${name}.png`) });
    await s.goto('/?course=0401212'); await p.screenshot({ path: resolve(dir,`course-${name}.png`), fullPage: true });
    if (name === 'desktop' || name === 'mobile') {
      await openContribution(p); await p.getByText('Security check complete.', { exact: true }).waitFor();
      await p.screenshot({ path: resolve(dir,`contribution-${name}-simulated.png`) }); await p.keyboard.press('Escape');
    }
  }
  await p.setViewportSize({ width: 1440, height: 1000 }); await s.goto('/?view=about');
  await p.screenshot({ path: resolve(dir,'about-desktop.png'), fullPage: true });
  await p.goto(origin + '/assets/brand/source.svg'); await p.screenshot({ path: resolve(dir,'brand-source.png') });
  await s.close();
});
