import { TRACKS, TYPES, CONFIG, FILE_POLICIES } from './config.mjs';

export const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/u;
const unsafeMetadata = /[<>\u202a-\u202e\u2066-\u2069]/u;
export function cleanText(value, min, max) {
  if (typeof value !== 'string' || CONTROL_CHARS.test(value) || unsafeMetadata.test(value)) return null;
  const clean = value.trim().replace(/[ \t]+/g, ' ');
  return clean.length >= min && clean.length <= max ? clean : null;
}
export function httpsUrl(value) {
  if (typeof value !== 'string' || CONTROL_CHARS.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Catalogs are published data only. Never read submission branches or receipts.
export function parseCatalog(courses, resources) {
  const requireValid = (ok) => { if (!ok) throw new Error('The published catalog could not be read.'); };
  const clean = (v, min, max) => typeof v === 'string' && v === v.trim()
    && v.length >= min && v.length <= max && !CONTROL_CHARS.test(v);
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  requireValid(Array.isArray(courses) && courses.length > 0 && Array.isArray(resources));
  const byId = new Map();
  for (const course of courses) {
    requireValid(object(course) && /^\d{6,7}$/.test(course.id) && typeof course.id === 'string'
      && !byId.has(course.id) && clean(course.name, 2, 160)
      && Array.isArray(course.tracks) && course.tracks.length > 0
      && course.tracks.every(t => TRACKS.includes(t)) && new Set(course.tracks).size === course.tracks.length);
    byId.set(course.id, { ...course, resources: [] });
  }
  const seen = new Set();
  for (const resource of resources) {
    requireValid(object(resource) && clean(resource.id, 1, 80) && !seen.has(resource.id)
      && byId.has(resource.course_id) && TYPES.includes(resource.type)
      && clean(resource.title, 3, 120) && clean(resource.semester, 4, 20)
      && (resource.contributor == null || clean(resource.contributor, 1, 40))
      && clean(resource.asset_url, 1, 4096) && httpsUrl(resource.asset_url)
      && typeof resource.created_at === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(resource.created_at)
      && Number.isFinite(Date.parse(resource.created_at))
      && new Date(resource.created_at).toISOString() === resource.created_at);
    seen.add(resource.id);
    byId.get(resource.course_id).resources.push({ ...resource, asset_url: httpsUrl(resource.asset_url) });
  }
  for (const course of byId.values()) course.resources.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { courses: [...byId.values()], byId, resourceCount: resources.length };
}

export async function loadCatalog() {
  const values = await Promise.all(['courses', 'resources'].map(async name => {
    const response = await fetch(new URL(`../${name}.json`, import.meta.url), {
      headers: { Accept: 'application/json' }, cache: 'no-store'
    });
    if (!response.ok) throw new Error('The archive could not be loaded.');
    return response.json();
  }));
  return parseCatalog(...values);
}

export function filterCourses(courses, query, track) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return courses.filter(course => (track === 'All' || course.tracks.includes(track))
    && terms.every(term => `${course.id} ${course.name} ${course.resources.map(r => r.title).join(' ')}`.toLocaleLowerCase().includes(term)));
}

export function readRoute(href) {
  const params = new URL(href).searchParams;
  return {
    course: params.get('course') || '',
    about: params.get('view') === 'about',
    query: params.get('q') || '',
    track: TRACKS.includes(params.get('track')) ? params.get('track') : 'All'
  };
}
export function routeUrl({ course = '', about = false, query = '', track = 'All' }, pathname = '/') {
  const params = new URLSearchParams();
  if (course) params.set('course', course);
  else if (about) params.set('view', 'about');
  if (query) params.set('q', query);
  if (TRACKS.includes(track)) params.set('track', track);
  return pathname + (params.size ? `?${params}` : '');
}

export async function validateFile(file) {
  if (!file || typeof file.slice !== 'function') return 'Choose a file to contribute.';
  if (!file.name?.trim() || CONTROL_CHARS.test(file.name)) return 'Choose a file with a valid filename.';
  if (!file.size) return 'This file is empty. Choose a file with content.';
  if (file.size > CONFIG.maxFileSize) return 'This file is too large. The limit is 24 MiB.';
  const extension = /\.[a-z0-9]+$/i.exec(file.name.trim())?.[0].toLowerCase();
  const policy = FILE_POLICIES[extension];
  if (!policy) return 'Choose a PDF, DOCX, ZIP, PNG or JPG file.';
  if (!policy.allowedMimes.has((file.type || '').split(';')[0].trim().toLowerCase())) {
    return 'The file type does not match its extension. Export it again in a supported format.';
  }
  try {
    const bytes = new Uint8Array(await file.slice(0, policy.signature.length).arrayBuffer());
    if (!policy.signature.every((byte, i) => bytes[i] === byte)) {
      return 'This file does not appear to be a valid ' + extension.slice(1).toUpperCase() + '. Choose another file.';
    }
  } catch { return 'This file could not be read. Please select it again.'; }
  return '';
}
