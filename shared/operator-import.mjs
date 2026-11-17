/** Shared wire contract; no Node APIs or network calls. */
export const IMPORT_ATTESTATION = Object.freeze({
  version: 'operator-permission-v1',
  text: 'I confirm that I have permission from the relevant owners or authors to publish each selected document. This is an operator-attested, permission-based import with no public contributor credit; I am not claiming authorship.',
});
export const SEMESTERS = Object.freeze(['Fall', 'Spring', 'Summer']);
export const MAX_IMPORT_FILE = 24 * 1024 * 1024;
export const SHA256 = /^[a-f0-9]{64}$/;
export const OPERATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** @param {unknown} value */
export function normalizeTerm(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('academic_term must be an object.');
  const term = /** @type {{academic_year?:unknown,semester?:unknown}} */ (value);
  if (Object.keys(term).sort().join(',') !== 'academic_year,semester') throw new Error('academic_term requires only academic_year and semester.');
  const year = term.academic_year, semester = term.semester;
  if (year !== null && (typeof year !== 'string' || !/^\d{4}-\d{4}$/.test(year) ||
      Number(year.slice(5)) !== Number(year.slice(0,4)) + 1 || Number(year.slice(0,4)) < 1900 || Number(year.slice(0,4)) > 2199)) {
    throw new Error('academic_year must be null or consecutive YYYY-YYYY (1900–2199 start).');
  }
  if (semester !== null && (typeof semester !== 'string' || !SEMESTERS.includes(semester))) throw new Error('Unsupported semester.');
  // The existing backend uses one optional, at-most-20-character semester string.
  return [semester, year].filter(v => v !== null).join(' ');
}

/** @param {{file_sha256:string,course_id:string,type:string,title:string,semester:string,filename:string}} value */
export function importRequestMaterial(value) {
  const clean = (/** @type {string} */ text) => text.trim().replace(/[ \t]+/g,' ');
  return JSON.stringify([value.file_sha256,clean(value.course_id),value.type,clean(value.title),clean(value.semester),
    value.filename.trim(),IMPORT_ATTESTATION.version]);
}
