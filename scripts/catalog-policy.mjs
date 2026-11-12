const tracks = new Set(['Cybersecurity', 'CS', 'AI']);
const types = new Set(['Practice Questions', 'Summary', 'Notes', 'Test Bank', 'Other']);
const clean = (s, min, max) => typeof s === 'string' && s === s.trim()
  && s.length >= min && s.length <= max && !/[\x00-\x1f\x7f-\x9f]/u.test(s);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const requireValid = (ok, message) => { if (!ok) throw new Error(message); };

export function validateCatalogs(courses, resources) {
  requireValid(Array.isArray(courses) && courses.length > 0, 'courses must be a nonempty array');
  requireValid(Array.isArray(resources), 'resources must be an array');
  const courseIds = new Set();
  for (const [i, c] of courses.entries()) {
    const context = `courses[${i}]`;
    requireValid(object(c), `${context}: expected object`);
    requireValid(typeof c.id === 'string' && /^\d{6,7}$/.test(c.id)
      && !courseIds.has(c.id), `${context}: invalid or duplicate id`);
    requireValid(clean(c.name, 2, 160), `${context}: invalid name`);
    requireValid(Array.isArray(c.tracks) && c.tracks.length > 0
      && c.tracks.every(t => tracks.has(t)) && new Set(c.tracks).size === c.tracks.length,
    `${context}: invalid or duplicate tracks`);
    courseIds.add(c.id);
  }
  const resourceIds = new Set();
  for (const [i, r] of resources.entries()) {
    const context = `resources[${i}]`;
    requireValid(object(r), `${context}: expected object`);
    requireValid(clean(r.id, 1, 80) && !resourceIds.has(r.id), `${context}: invalid or duplicate id`);
    requireValid(courseIds.has(r.course_id), `${context}: unknown course_id`);
    requireValid(types.has(r.type), `${context}: invalid type`);
    requireValid(clean(r.title, 3, 120) && clean(r.semester, 4, 20), `${context}: invalid metadata`);
    requireValid(r.contributor == null || clean(r.contributor, 1, 40), `${context}: invalid contributor`);
    let url;
    try { url = new URL(r.asset_url); } catch { /* Report below. */ }
    requireValid(clean(r.asset_url, 1, 4096) && url?.protocol === 'https:'
      && !url.username && !url.password, `${context}: expected HTTPS asset_url without credentials`);
    requireValid(typeof r.created_at === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.created_at)
      && Number.isFinite(Date.parse(r.created_at))
      && new Date(r.created_at).toISOString() === r.created_at, `${context}: invalid UTC created_at`);
    resourceIds.add(r.id);
  }
  return { courses: courses.length, resources: resources.length };
}
