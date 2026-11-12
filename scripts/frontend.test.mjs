import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCatalog, filterCourses, readRoute, routeUrl, validateFile, cleanText } from '../site/js/catalog.mjs';
import { CONFIG, TYPES } from '../site/js/config.mjs';
import { validateCatalogs } from './catalog-policy.mjs';

const courses = JSON.parse(await readFile(new URL('../site/courses.json', import.meta.url)));
const sample = { id: 'synthetic', course_id: '0401212', type: 'Summary', title: 'Synthetic trees summary',
  semester: 'Fall 2026', asset_url: 'https://assets.example.invalid/synthetic.pdf', created_at: '2026-01-01T00:00:00.000Z' };

test('browser consumes the real published catalogs, preserving empty courses', async () => {
  const resources = JSON.parse(await readFile(new URL('../site/resources.json', import.meta.url)));
  const catalog = parseCatalog(courses, resources);
  assert.equal(catalog.courses.length, courses.length);
  assert.equal(catalog.resourceCount, resources.length);
  assert.deepEqual(catalog.courses.map(c => c.id), courses.map(c => c.id));
});
test('name, exact code, resource search and track intersection', () => {
  const catalog = parseCatalog(courses, [sample]);
  assert.equal(filterCourses(catalog.courses, '0401212', 'CS')[0].name, 'Data Structures');
  assert.equal(filterCourses(catalog.courses, 'synthetic trees', 'All')[0].id, '0401212');
  assert(filterCourses(catalog.courses, 'programming', 'AI').every(c => c.tracks.includes('AI')));
  assert.equal(filterCourses(catalog.courses, 'nonexistent-course', 'All').length, 0);
});
test('URLs round-trip leading zeros, unicode, filters and reserved characters', () => {
  const route = { course: '0401212', about: false, query: 'data & بحث + structures', track: 'CS', hasMaterials: true };
  assert.deepEqual(readRoute('https://archive.example' + routeUrl(route)), route);
  assert.equal(readRoute('https://archive.example/?track=unknown').track, 'All');
  assert.equal(routeUrl({ query: 'data' }, '/preview/index.html'), '/preview/index.html?q=data');
});
test('browser rejects malformed catalogs and unsafe resource URLs like repository policy', () => {
  for (const patch of [{ asset_url: 'javascript:alert(1)' }, { asset_url: 'https://user:password@example.invalid/file' },
    { type: 'Past Paper' }, { course_id: '9999999' }, { created_at: '2026-02-30T00:00:00.000Z' },
    { contributor: 'line\nbreak' }, { title: 'x' }]) {
    assert.throws(() => validateCatalogs(courses, [{ ...sample, ...patch }]));
    assert.throws(() => parseCatalog(courses, [{ ...sample, ...patch }]));
  }
  assert.throws(() => parseCatalog([...courses, courses[0]], []));
  assert.throws(() => parseCatalog(courses, [sample, sample]));
  for (const type of TYPES) assert.doesNotThrow(() => validateCatalogs(courses, [{ ...sample, type }]));
});
test('five resource types validate and normalize consistently with repository policy', () => {
  assert.deepEqual(TYPES, ['Practice Questions', 'Summary', 'Notes', 'Test Bank', 'Other']);
  for (const type of TYPES) {
    const resources = [{ ...sample, type }];
    assert.equal(validateCatalogs(courses, resources).resources, 1);
    assert.equal(parseCatalog(courses, resources).byId.get(sample.course_id).resources[0].type, type);
  }
});
test('materials filter intersects normalized published resources, search and track', () => {
  const catalog = parseCatalog(courses.map(c => c.id === sample.course_id ? {...c, tracks: ['CS']} : c), [sample]);
  assert.equal(filterCourses(catalog.courses, '', 'All').length, courses.length);
  assert.deepEqual(filterCourses(catalog.courses, '', 'All', true).map(c => c.id), [sample.course_id]);
  assert.equal(filterCourses(catalog.courses, 'synthetic trees', 'CS', true).length, 1);
  assert.equal(filterCourses(catalog.courses, 'synthetic trees', 'Cybersecurity', true).length, 0);
  assert.equal(filterCourses(catalog.courses, 'no match', 'All', true).length, 0);
  assert.equal(filterCourses(parseCatalog(courses, []).courses, '', 'All', true).length, 0);
});
test('materials URL follows first-value routing and canonicalizes invalid/duplicate parameters', () => {
  for (const [query, enabled] of [['', false], ['1', true], ['0', false], ['true', false], ['01', false],
    ['1&hasMaterials=0', true], ['0&hasMaterials=1', false], ['bad&hasMaterials=1', false], ['1&hasMaterials=1', true]]) {
    const route = readRoute(`https://archive.example/?hasMaterials=${query}`);
    assert.equal(route.hasMaterials, enabled);
    const params = new URL('https://archive.example' + routeUrl(route)).searchParams;
    assert.deepEqual(params.getAll('hasMaterials'), enabled ? ['1'] : []);
  }
  assert.equal(routeUrl({ hasMaterials: '1' }), '/');
});
test('metadata guards match new Worker restrictions without changing the contract', () => {
  assert.equal(cleanText('  Midterm   summary  ', 3, 120), 'Midterm summary');
  for (const value of ['<script>', 'hidden\u202etext', 'line\nbreak', 'ab']) assert.equal(cleanText(value, 3, 120), null);
});
test('all supported file signatures pass; MIME, extension, size and header mismatches fail', async () => {
  const valid = [
    ['file.pdf', 'application/pdf', [0x25,0x50,0x44,0x46,0x2d]],
    ['file.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', [0x50,0x4b,3,4]],
    ['file.zip', 'application/zip', [0x50,0x4b,3,4]],
    ['file.png', 'image/png', [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]],
    ['file.jpg', 'image/jpeg', [0xff,0xd8,0xff]]
  ];
  for (const [name, type, bytes] of valid) assert.equal(await validateFile(new File([new Uint8Array(bytes)], name, { type })), '');
  for (const file of [new File([], 'empty.pdf', { type: 'application/pdf' }),
    new File(['not a pdf'], 'file.pdf', { type: 'application/pdf' }),
    new File(['%PDF-'], 'file.pdf', { type: 'text/plain' }), new File(['hello'], 'file.exe'),
    new File([new Uint8Array(CONFIG.maxFileSize + 1)], 'large.pdf', { type: 'application/pdf' })]) {
    assert.notEqual(await validateFile(file), '');
  }
});

test('standalone identity marks and favicon preserve the supplied SVG geometry', async () => {
  const source = await readFile(new URL('../site/assets/brand/source.svg', import.meta.url), 'utf8');
  const hashPath = /<path id="hash" d="([^"]+)"/.exec(source)[1];
  for (const path of ['assets/brand/root.svg','assets/brand/archive.svg','assets/brand/cs.svg',
    'assets/brand/cybersecurity.svg','assets/brand/ai.svg','assets/brand/competitions.svg','favicon.svg']) {
    const svg = await readFile(new URL('../site/' + path, import.meta.url), 'utf8');
    assert(svg.includes(`d="${hashPath}"`));
    assert(svg.includes('x="50" y="61" width="46" height="3.5"'));
    assert(!/<text|<use|font-family/.test(svg));
  }
});
