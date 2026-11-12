import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogs } from './catalogs.mjs';

const courses = [{id: '0401111', name: 'Discrete Structures', tracks: ['CS']}];
const resource = {id: 'synthetic-1', course_id: '0401111', type: 'Summary',
  title: 'Synthetic resource', semester: 'Fall 2026', contributor: null,
  asset_url: 'https://assets.example.invalid/example.pdf', created_at: '2026-01-01T00:00:00.000Z'};

test('empty resource catalog and valid published resource', () => {
  assert.deepEqual(validateCatalogs(courses, []), {courses: 1, resources: 0});
  assert.equal(validateCatalogs(courses, [resource]).resources, 1);
});
test('invalid courses fail instead of silently disappearing', () => {
  for (const value of [null, [], [null], [...courses, ...courses],
    [{...courses[0], id: 401111}], [{...courses[0], tracks: ['CS', 'CS']}],
    [{...courses[0], tracks: ['Unknown']}], [{...courses[0], name: 'bad\nname'}]]) {
    assert.throws(() => validateCatalogs(value, []));
  }
});
test('resource integrity and unsafe metadata failures', () => {
  for (const patch of [{course_id: '9999999'}, {type: 'Past Paper'}, {title: 'a'},
    {semester: 'x'}, {contributor: 'bad\nname'}, {id: ''},
    {asset_url: 'javascript:alert(1)'}, {asset_url: 'http://example.invalid'},
    {asset_url: 'https://name:secret@example.invalid/a'},
    {created_at: '2026-02-30T00:00:00.000Z'}, {created_at: 'invalid'}]) {
    assert.throws(() => validateCatalogs(courses, [{...resource, ...patch}]));
  }
  assert.throws(() => validateCatalogs(courses, [resource, resource]), /duplicate/);
  assert.throws(() => validateCatalogs(courses, {}));
});
