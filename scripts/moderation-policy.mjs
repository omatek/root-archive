import { validateCatalogs } from './catalog-policy.mjs';

export const submissionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const managedKeyPattern = /^assets\/v1\/([0-9a-f-]{36})\.(pdf|docx|zip|png|jpg)$/;
const fail = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
function exactKeys(v, keys) {
  return v && typeof v === 'object' && !Array.isArray(v)
    && same(Object.keys(v).sort(), keys.sort());
}

export function validateRecord(record, courses, assetBase) {
  fail(exactKeys(record, ['schema', 'object_key', 'resource']) && record.schema === 1, 'Invalid submission record');
  const r = record.resource;
  fail(exactKeys(r, ['id', 'course_id', 'type', 'title', 'semester', 'asset_url', 'contributor', 'created_at']), 'Invalid resource fields');
  validateCatalogs(courses, [r]);
  fail(submissionIdPattern.test(r.id), 'Invalid generated submission ID');
  const match = typeof record.object_key === 'string' && managedKeyPattern.exec(record.object_key);
  fail(match && match[1] === r.id, 'Object identity does not match submission');
  const base = new URL(assetBase);
  fail(base.protocol === 'https:' && base.origin === assetBase, 'Invalid managed asset base');
  fail(r.asset_url === `${assetBase}/${record.object_key}`, 'Asset must use the exact managed R2 key');
  for (const value of [r.title, r.semester, r.contributor ?? '']) {
    fail(!/[<>\u202a-\u202e\u2066-\u2069]/u.test(value), 'Unsafe metadata');
  }
  return r;
}

// HEAD must include the latest protected base. Compare whole trees, never a
// merge-base patch alone: a stale full-file replacement can lose another upload.
export function validateProposal({courses, base, proposed, record, changes, assetBase}) {
  const resource = validateRecord(record, courses, assetBase);
  validateCatalogs(courses, base);
  validateCatalogs(courses, proposed);
  const path = `submissions/${resource.id}.json`;
  fail(changes.length === 2 && changes.some(c => c.path === 'site/resources.json' && c.status === 'M')
    && changes.some(c => c.path === path && c.status === 'A')
    && changes.every(c => c.mode === '100644'), 'Submission may only modify the catalog and add its record');
  fail(proposed.length === base.length + 1, 'Expected exactly one catalog addition');
  fail(base.every((entry, i) => same(entry, proposed[i])), 'Existing catalog entries must remain unchanged and ordered; reconcile stale PR');
  fail(same(proposed.at(-1), resource), 'Catalog addition must match the submission record');
  fail(!base.some(r => r.id === resource.id || r.asset_url === resource.asset_url), 'Resource ID or object is already published');
  return resource;
}
