import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { CONFIG } from '../../site/js/config.mjs';

const root = resolve(fileURLToPath(new URL('../../site/', import.meta.url)));
const realCourses = JSON.parse(await readFile(resolve(root, 'courses.json')));
const realResources = JSON.parse(await readFile(resolve(root, 'resources.json')));
const axeSource = await readFile(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
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
      res.setHeader('Content-Type', ({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(target)] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  // No external request can leave a browser test. GIS, Turnstile and Worker are explicit mocks.
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url === origin + '/courses.json') {
      if (options.failLoad) return route.fulfill({ status: 503, body: 'unavailable' });
      return route.fulfill({ json: options.courses || realCourses });
    }
    if (url === origin + '/resources.json') return route.fulfill({ json: options.resources || realResources });
    if (url.startsWith(origin + '/')) return route.continue();
    if (options.externalFailure) return route.abort();
    if (url.startsWith('https://accounts.google.com/gsi/client')) {
      return route.fulfill({ contentType: 'text/javascript', body: `window.google = { accounts: { id: {
        initialize(options) { window.testIdentity = options; },
        renderButton(slot) { const button = document.createElement('button'); button.type='button'; button.textContent='Google sign-in (simulated)'; button.onclick=()=>window.testIdentity.callback({credential:${JSON.stringify(fakeCredential)}}); slot.append(button); },
        disableAutoSelect() {}
      } } };` });
    }
    if (url.startsWith('https://challenges.cloudflare.com/turnstile/')) {
      return route.fulfill({ contentType: 'text/javascript', body: `window.turnstile = {
        render(slot, options) { window.testSecurity = options; slot.textContent = 'Security check (simulated)'; options.callback('synthetic-turnstile-token'); return 'test-widget'; },
        reset() { window.testSecurity.callback('synthetic-turnstile-token'); }, isExpired() { return false; }
      };` });
    }
    if (url === CONFIG.submissionEndpoint + '/auth/verify') {
      requests.push({ type: 'verify', headers: request.headers() });
      return route.fulfill({ status: options.authStatus || 200, json: options.authPayload || { success: true, authorized: options.authStatus ? false : true } });
    }
    if (url === new URL(CONFIG.submissionEndpoint).href) {
      requests.push({ type: 'submit', body: request.postData(), headers: request.headers() });
      if (options.holdUpload) await options.holdUpload;
      if (options.networkFailure) return route.abort();
      return route.fulfill({ status: options.uploadStatus || 201, json: options.uploadPayload || {
        success: !options.uploadStatus, pr_url: 'https://github.com/omatek/root-archive/pull/999999',
        asset_url: 'https://assets.example.invalid/pending-must-not-render.pdf'
      } });
    }
    if (url.startsWith('https://assets.example.invalid/')) {
      return route.fulfill({ contentType: 'text/plain', body: 'Synthetic resource payload' });
    }
    return route.abort();
  });
  async function goto(path = '/') { await page.goto(origin + path); await page.locator('#load-state').waitFor({ state: 'hidden' }); }
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
  await page.getByText('University account verified.', { exact: true }).waitFor();
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
  const resources = Array.from({ length: 14 }, (_, i) => ({ ...fixture, id: `synthetic-${i}`, type: i % 2 ? 'Past Paper' : 'Summary', title: i === 0 ? 'x'.repeat(120) : `Synthetic resource ${i}` }));
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
  await p.getByText(/This account is not eligible/).waitFor();
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
  await p.getByText('University account verified.', { exact: true }).waitFor();
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
