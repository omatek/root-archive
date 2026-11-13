/** Private first-party moderation. This entrypoint has no GitHub publication path. */
import courses from '../site/courses.json';
import {TYPES} from '../site/js/config.mjs';
import {
  WorkerHttpError, verifyGoogleStudentToken, parseMultipartWithByteLimit,
  validateAndExtractPayload, verifyTurnstileToken, sanitizeFilename,
} from './worker';
import {authorizeAdmin, exactOrigin} from './moderation-auth';

type RuntimeBindings = {[K in keyof ModerationBindings]: ModerationBindings[K] extends string ? string : ModerationBindings[K]};
export interface ModerationEnv extends RuntimeBindings {
  TURNSTILE_SECRET: string;
}

type Status = 'receiving' | 'pending' | 'under_review' | 'published' | 'unpublished' | 'rejected' | 'removed';
interface Submission {
  id: string; course_id: string; type: string; title: string; semester: string; contributor: string | null;
  contributor_sub: string | null; contributor_email: string | null; status: Status; version: number;
  original_revision_id: string | null; candidate_revision_id: string | null;
  created_at: string; updated_at: string; decision_at: string | null; decided_by: string | null;
  reason: string | null; last_operation: string;
}
interface Revision {
  id: string; submission_id: string; object_key: string; kind: 'original' | 'replacement'; filename: string;
  mime: string; size: number; etag: string | null; status: 'uploading' | 'ready' | 'delete_pending' | 'deleted';
  created_at: string; created_by: string; upload_deadline: string; delete_after: string | null;
  delete_attempts: number; last_delete_error: string | null; deleted_at: string | null;
}
interface Resource {
  id: string; course_id: string; type: string; title: string; semester: string; contributor: string | null;
  revision_id: string | null; status: 'published' | 'unpublished' | 'removed';
  published_at: string; updated_at: string; published_by: string;
}
interface Metadata {course_id: string; type: string; title: string; semester: string; contributor: string | null}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BAD_TEXT = /[\x00-\x1f\x7f-\x9f<>\u202a-\u202e\u2066-\u2069]/u;
const MAX_BODY = 25 * 1024 * 1024;
const HOUR = 3600000;
const PRIVATE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, max-age=0', 'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
};
const FILE_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'";
const COURSE_IDS = new Set(courses.map(c => c.id));
const EDITABLE = "('pending','under_review','published','unpublished')";
const statement = (env: ModerationEnv, sql: string, ...values: (string | number | null)[]) => env.DB.prepare(sql).bind(...values);
const iso = () => new Date().toISOString();

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {status, headers: {...PRIVATE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers}});
}
function assertId(id: string) {if (!UUID.test(id)) throw new WorkerHttpError(404, 'Record not found.');}
function requireVersion(value: unknown): number {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) throw new WorkerHttpError(400, 'A current record version is required.');
  return n;
}
function text(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'string' || BAD_TEXT.test(value)) throw new WorkerHttpError(400, `Invalid ${label}.`);
  const cleaned = value.trim().replace(/[ \t]+/g, ' ');
  if (cleaned.length < min || cleaned.length > max) throw new WorkerHttpError(400, `Invalid ${label}.`);
  return cleaned;
}
function metadata(value: Record<string, unknown>): Metadata {
  const course_id = text(value.course_id, 'course', 6, 7);
  if (!COURSE_IDS.has(course_id)) throw new WorkerHttpError(400, 'Unknown course.');
  const type = text(value.type, 'type', 1, 40);
  if (!(TYPES as string[]).includes(type)) throw new WorkerHttpError(400, 'Unknown resource type.');
  const semester = text(value.semester ?? '', 'semester', 0, 20);
  if (semester && semester.length < 4) throw new WorkerHttpError(400, 'Semester must have 4–20 characters or be empty.');
  return {course_id, type, title: text(value.title, 'title', 3, 120), semester,
    contributor: value.contributor == null || value.contributor === '' ? null : text(value.contributor, 'public credit', 1, 40)};
}
async function readJSON(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new WorkerHttpError(415, 'JSON is required.');
  const reader = request.body?.getReader();
  if (!reader) throw new WorkerHttpError(400, 'Request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > 8192) {await reader.cancel(); throw new WorkerHttpError(413, 'Request body is too large.');}
    chunks.push(next.value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {all.set(chunk, offset); offset += chunk.length;}
  try {
    const result: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(all));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch {throw new WorkerHttpError(400, 'Invalid JSON.');}
}
function page(url: URL) {
  const raw = url.searchParams.get('cursor') ?? '0';
  if (!/^\d{1,6}$/.test(raw)) throw new WorkerHttpError(400, 'Invalid page cursor.');
  return Number(raw);
}
function publicRecord(r: Resource, env: ModerationEnv) {
  return {id: r.id, course_id: r.course_id, type: r.type, title: r.title, semester: r.semester,
    contributor: r.contributor, created_at: r.published_at, asset_url: `${env.PUBLIC_API_ORIGIN}/download/${r.id}`};
}
async function getSubmission(env: ModerationEnv, id: string) {
  assertId(id);
  const record = await statement(env, 'SELECT * FROM submissions WHERE id=?', id).first<Submission>();
  if (!record || record.status === 'receiving') throw new WorkerHttpError(404, 'Record not found.');
  return record;
}
async function detail(env: ModerationEnv, id: string) {
  const record = await getSubmission(env, id);
  const revisions = await statement(env, 'SELECT * FROM file_revisions WHERE submission_id=? ORDER BY created_at,id', id).all<Revision>();
  const audit = await statement(env, 'SELECT action,actor,created_at,reason FROM moderation_audit WHERE submission_id=? ORDER BY id DESC LIMIT 100', id).all();
  const published = await statement(env, 'SELECT * FROM resources WHERE id=?', id).first<Resource>();
  const {last_operation: _operation, ...submission} = record;
  return {submission, revisions: revisions.results.map(r => ({id:r.id, kind:r.kind, filename:r.filename, mime:r.mime,
    size:r.size, status:r.status, created_at:r.created_at, created_by:r.created_by,
    delete_attempts:r.delete_attempts, last_delete_error:r.last_delete_error})), audit: audit.results,
    published: published ? {...publicRecord(published, env), revision_id:published.revision_id,
      status:published.status, published_at:published.published_at, updated_at:published.updated_at} : null};
}
function auditStatement(env: ModerationEnv, id: string, operation: string, action: string, actor: string, now: string, reason: string | null = null) {
  return statement(env, `INSERT INTO moderation_audit(submission_id,action,actor,created_at,reason,operation_id)
    SELECT id,?,?,?,?,? FROM submissions WHERE id=? AND last_operation=?`, action, actor, now, reason, operation, id, operation);
}
async function mutation(env: ModerationEnv, statements: D1PreparedStatement[]) {
  // D1 batch is one transaction: neither audit nor publication can outlive a failed guarded update.
  const results = await env.DB.batch(statements);
  if (results[0].meta.changes !== 1) throw new WorkerHttpError(409, 'This record changed. Reload it before deciding.');
}

async function listPublic(url: URL, env: ModerationEnv) {
  const offset = page(url);
  const course = url.searchParams.get('course_id');
  if (course && !COURSE_IDS.has(course)) throw new WorkerHttpError(400, 'Unknown course.');
  const rows = await statement(env, `SELECT * FROM resources WHERE status='published' ${course ? 'AND course_id=?' : ''}
    ORDER BY published_at DESC,id LIMIT 201 OFFSET ?`, ...(course ? [course, offset] : [offset])).all<Resource>();
  return json({resources:rows.results.slice(0,200).map(r => publicRecord(r,env)),
    next_cursor:rows.results.length > 200 ? String(offset + 200) : null}, 200, {'Access-Control-Allow-Origin':'*'});
}
async function download(request: Request, env: ModerationEnv, id: string) {
  assertId(id);
  // Deliberately use DB directly, never a read-replica session, KV, Cache API, or an R2 public URL.
  const live = await statement(env, `SELECT r.*, f.object_key,f.filename,f.mime,f.size,f.etag FROM resources r
    JOIN file_revisions f ON f.id=r.revision_id WHERE r.id=? AND r.status='published' AND f.status='ready'`, id)
    .first<Resource & Pick<Revision,'object_key'|'filename'|'mime'|'size'|'etag'>>();
  if (!live) throw new WorkerHttpError(404, 'Resource is unavailable.');
  const object = request.method === 'HEAD' ? await env.PRIVATE_FILES.head(live.object_key) : await env.PRIVATE_FILES.get(live.object_key);
  if (!object || object.size !== live.size || object.etag !== live.etag) throw new WorkerHttpError(404, 'Resource is unavailable.');
  // Recheck after storage access: a concurrent withdrawal/replacement cannot grant a new response using an old pointer.
  const stillLive = await statement(env, "SELECT id FROM resources WHERE id=? AND status='published' AND revision_id=?", id, live.revision_id).first();
  if (!stillLive) throw new WorkerHttpError(404, 'Resource is unavailable.');
  const headers = {...PRIVATE_HEADERS, 'Access-Control-Allow-Origin':'*', 'Content-Type':live.mime,
    'Content-Length':String(live.size), 'Content-Disposition':`attachment; filename="${sanitizeFilename(live.filename)}"`,
    'Content-Security-Policy':FILE_CSP, 'Cross-Origin-Resource-Policy':'cross-origin'};
  return new Response(request.method === 'HEAD' ? null : (object as R2ObjectBody).body, {headers});
}
async function submission(request: Request, env: ModerationEnv) {
  const identity = await verifyGoogleStudentToken(request, env);
  if (env.SUBMISSIONS_ENABLED !== 'true') throw new WorkerHttpError(503, 'Contributions are temporarily unavailable. Please try again later.');
  if (!env.TURNSTILE_SECRET?.trim()) throw new WorkerHttpError(503, 'Contributions are temporarily unavailable.');
  const form = await parseMultipartWithByteLimit(request, MAX_BODY);
  const payload = await validateAndExtractPayload(form, {optionalSemester:true});
  await verifyTurnstileToken(env.TURNSTILE_SECRET, payload.turnstileToken, request.headers.get('CF-Connecting-IP'));
  const id = crypto.randomUUID(), revisionId = crypto.randomUUID(), intentOperation = crypto.randomUUID(), operation = crypto.randomUUID(), now = iso();
  const key = `private/v1/${id}/${revisionId}${payload.fileExtension}`;
  const deadline = new Date(Date.now() + HOUR).toISOString();
  // Record the upload intent before R2. A crash or ambiguous PUT is discoverable by cleanup without listing objects.
  await env.DB.batch([
    statement(env, `INSERT INTO submissions(id,course_id,type,title,semester,contributor,contributor_sub,contributor_email,status,
      created_at,updated_at,last_operation) VALUES(?,?,?,?,?,?,?,?,'receiving',?,?,?)`, id,payload.courseId,payload.type,payload.title,
      payload.semester,payload.contributor,identity.sub,identity.email,now,now,intentOperation),
    statement(env, `INSERT INTO file_revisions(id,submission_id,object_key,kind,filename,mime,size,status,created_at,created_by,upload_deadline)
      VALUES(?,?,?,'original',?,?,?,'uploading',?,'contributor',?)`, revisionId,id,key,sanitizeFilename(payload.fileName),payload.fileMimeType,payload.fileBytes.byteLength,now,deadline),
  ]);
  try {
    const object = await env.PRIVATE_FILES.put(key,payload.fileBytes, {onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:payload.fileMimeType}});
    if (!object || object.size !== payload.fileBytes.byteLength) throw new Error('incomplete_upload');
    await mutation(env,[
      statement(env, `UPDATE submissions SET status='pending',original_revision_id=?,candidate_revision_id=?,last_operation=?,updated_at=?
        WHERE id=? AND status='receiving' AND EXISTS(SELECT 1 FROM file_revisions WHERE id=? AND status='uploading')`,revisionId,revisionId,operation,now,id,revisionId),
      statement(env, `UPDATE file_revisions SET status='ready',etag=? WHERE id=? AND status='uploading'
        AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND last_operation=? AND status='pending')`,object.etag,revisionId,id,operation),
      auditStatement(env,id,operation,'submission_received','contributor',now),
    ]);
  } catch {
    await abandonUpload(env,id,revisionId).catch(() => console.error(JSON.stringify({event:'private_upload_recovery_needed',id})));
    throw new WorkerHttpError(502, 'The upload could not be confirmed. Keep your draft and try again later.');
  }
  return json({success:true,submission_id:id},201);
}
async function abandonUpload(env: ModerationEnv, id: string, revisionId: string) {
  const now = iso();
  await env.DB.batch([
    statement(env, `UPDATE file_revisions SET status='delete_pending',delete_after=? WHERE id=? AND status IN ('uploading','delete_pending')`,now,revisionId),
    statement(env, `UPDATE submissions SET status='rejected',title='Upload not completed',semester='',contributor=NULL,
      contributor_sub=NULL,contributor_email=NULL,reason='Upload not completed',updated_at=? WHERE id=? AND status='receiving'`,now,id),
  ]);
  await runPrivateCleanup(env,1);
}

async function listAdmin(url: URL, env: ModerationEnv) {
  const view = url.searchParams.get('view') ?? 'pending';
  const conditions: Record<string,string> = {pending:"status IN ('pending','under_review','unpublished')",published:"status='published'",history:"status IN ('rejected','removed')"};
  if (!conditions[view]) throw new WorkerHttpError(400, 'Unknown moderation view.');
  const search = text(url.searchParams.get('search') ?? '', 'search',0,120);
  const offset = page(url);
  const rows = await statement(env, `SELECT id,course_id,type,title,semester,contributor,contributor_email,status,version,created_at,updated_at,reason
    FROM submissions WHERE ${conditions[view]} AND (?='' OR instr(lower(title),lower(?))>0 OR instr(course_id,?)>0)
    ORDER BY created_at DESC,id LIMIT 51 OFFSET ?`,search,search,search,offset).all();
  return json({submissions:rows.results.slice(0,50),next_cursor:rows.results.length>50?String(offset+50):null});
}
async function adminFile(request: Request, env: ModerationEnv, id: string, revisionId: string) {
  assertId(revisionId);
  const record = await getSubmission(env,id);
  if (['removed','rejected'].includes(record.status)) throw new WorkerHttpError(404,'File is unavailable.');
  const revision = await statement(env,"SELECT * FROM file_revisions WHERE id=? AND submission_id=? AND status='ready'",revisionId,id).first<Revision>();
  if (!revision) throw new WorkerHttpError(404,'File is unavailable.');
  const object = request.method === 'HEAD' ? await env.PRIVATE_FILES.head(revision.object_key) : await env.PRIVATE_FILES.get(revision.object_key);
  if (!object || object.etag !== revision.etag || object.size !== revision.size) throw new WorkerHttpError(404,'File is unavailable.');
  // No raw PDF, Office, ZIP, SVG or HTML executes in the portal's origin.
  const inline = ['image/png','image/jpeg'].includes(revision.mime);
  return new Response(request.method === 'HEAD'?null:(object as R2ObjectBody).body,{headers:{...PRIVATE_HEADERS,
    'Content-Type':revision.mime,'Content-Length':String(revision.size),'Content-Security-Policy':FILE_CSP,
    'Content-Disposition':`${inline?'inline':'attachment'}; filename="${sanitizeFilename(revision.filename)}"`,
    'Cross-Origin-Resource-Policy':'same-origin'}});
}
async function replaceFile(request: Request, env: ModerationEnv, actor: string, id: string) {
  const current = await getSubmission(env,id);
  if (!['pending','under_review','published','unpublished'].includes(current.status)) throw new WorkerHttpError(409,'This record cannot be edited.');
  const form = await parseMultipartWithByteLimit(request,MAX_BODY);
  for (const [key] of form) if (!['version','file'].includes(key) || form.getAll(key).length !== 1) throw new WorkerHttpError(400,'Unexpected or repeated replacement field.');
  const version = requireVersion(form.get('version'));
  if (version !== current.version) throw new WorkerHttpError(409,'This record changed. Reload it.');
  const validation = new FormData();
  for (const [key,value] of Object.entries({course_id:current.course_id,type:current.type,title:current.title,semester:current.semester,turnstile_token:'admin-replacement'})) validation.set(key,value);
  const file = form.get('file');
  if (!(file instanceof File)) throw new WorkerHttpError(400,'A replacement file is required.');
  validation.set('file',file,file.name);
  const payload = await validateAndExtractPayload(validation,{optionalSemester:true});
  const revisionId=crypto.randomUUID(),operation=crypto.randomUUID(),now=iso(),deadline=new Date(Date.now()+HOUR).toISOString();
  const key=`private/v1/${id}/${revisionId}${payload.fileExtension}`;
  const inserted = await statement(env,`INSERT INTO file_revisions(id,submission_id,object_key,kind,filename,mime,size,status,created_at,created_by,upload_deadline)
    SELECT ?,id,?,'replacement',?,?,?,'uploading',?,?,? FROM submissions WHERE id=? AND version=? AND status IN ${EDITABLE}`,
    revisionId,key,sanitizeFilename(payload.fileName),payload.fileMimeType,payload.fileBytes.byteLength,now,actor,deadline,id,version).run();
  if (inserted.meta.changes !== 1) throw new WorkerHttpError(409,'This record changed. Reload it.');
  try {
    const object=await env.PRIVATE_FILES.put(key,payload.fileBytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:payload.fileMimeType}});
    if (!object || object.size !== payload.fileBytes.byteLength) throw new Error('incomplete_upload');
    await mutation(env,[
      statement(env,`UPDATE submissions SET candidate_revision_id=?,version=version+1,updated_at=?,last_operation=?
        WHERE id=? AND version=? AND status IN ${EDITABLE} AND EXISTS(SELECT 1 FROM file_revisions WHERE id=? AND status='uploading')`,revisionId,now,operation,id,version,revisionId),
      statement(env,`UPDATE file_revisions SET status='ready',etag=? WHERE id=? AND status='uploading'
        AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND last_operation=?)`,object.etag,revisionId,id,operation),
      // Original is retained while preparing a candidate; superseded edited drafts need no indefinite retention.
      statement(env,`UPDATE file_revisions SET status='delete_pending',delete_after=? WHERE submission_id=? AND status='ready'
        AND id<>? AND kind<>'original' AND NOT EXISTS(SELECT 1 FROM resources WHERE id=? AND revision_id=file_revisions.id)
        AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND last_operation=?)`,now,id,revisionId,id,id,operation),
      auditStatement(env,id,operation,'file_replaced',actor,now),
    ]);
  } catch (error) {
    await abandonUpload(env,id,revisionId).catch(()=>console.error(JSON.stringify({event:'private_upload_recovery_needed',id})));
    if (error instanceof WorkerHttpError && error.status===409) throw error;
    throw new WorkerHttpError(502,'The replacement could not be confirmed. The approved version has been preserved.');
  }
  await runPrivateCleanup(env).catch(()=>console.error(JSON.stringify({event:'private_cleanup_deferred'})));
  return json(await detail(env,id));
}

async function adminAction(request: Request, env: ModerationEnv, actor: string, id: string, action: string) {
  const body=await readJSON(request),version=requireVersion(body.version),current=await getSubmission(env,id);
  // Idempotent approval retry is successful only while the exact same snapshot remains published.
  if (action==='approve' && current.status==='published' && current.version===version+1 && typeof body.revision_id==='string') {
    const done=await statement(env,"SELECT revision_id FROM resources WHERE id=? AND status='published'",id).first<{revision_id:string}>();
    const priorApproval=await statement(env,"SELECT id FROM moderation_audit WHERE operation_id=? AND action IN ('submission_approved','resource_modified')",current.last_operation).first();
    if(priorApproval && done?.revision_id===body.revision_id && current.candidate_revision_id===body.revision_id) return json(await detail(env,id));
  }
  if(version!==current.version) throw new WorkerHttpError(409,'This record changed. Reload it before deciding.');
  if(!['pending','under_review','published','unpublished'].includes(current.status)) throw new WorkerHttpError(409,'This decision is final.');
  const operation=crypto.randomUUID(),now=iso();
  if(action==='metadata') {
    const m=metadata(body);
    await mutation(env,[
      statement(env,`UPDATE submissions SET course_id=?,type=?,title=?,semester=?,contributor=?,version=version+1,updated_at=?,last_operation=?
        WHERE id=? AND version=? AND status IN ${EDITABLE}`,m.course_id,m.type,m.title,m.semester,m.contributor,now,operation,id,version),
      auditStatement(env,id,operation,'metadata_changed',actor,now),
    ]);
  } else if(action==='review') {
    if(!['pending','unpublished'].includes(current.status)) throw new WorkerHttpError(409,'The record is already being reviewed.');
    await mutation(env,[
      statement(env,"UPDATE submissions SET status='under_review',version=version+1,updated_at=?,last_operation=? WHERE id=? AND version=? AND status IN ('pending','unpublished')",now,operation,id,version),
      auditStatement(env,id,operation,'review_started',actor,now),
    ]);
  } else if(action==='approve') {
    const revisionId=body.revision_id;
    if(typeof revisionId!=='string' || revisionId!==current.candidate_revision_id) throw new WorkerHttpError(400,'Select and preview the current candidate before approval.');
    const m=metadata({...current});
    const revision=await statement(env,"SELECT * FROM file_revisions WHERE id=? AND submission_id=? AND status='ready'",revisionId,id).first<Revision>();
    if(!revision) throw new WorkerHttpError(409,'The candidate file is not ready.');
    const object=await env.PRIVATE_FILES.head(revision.object_key);
    if(!object || object.etag!==revision.etag || object.size!==revision.size) throw new WorkerHttpError(409,'The candidate file is missing or incomplete. Replace it before approval.');
    await mutation(env,[
      statement(env,`UPDATE submissions SET status='published',version=version+1,updated_at=?,decision_at=?,decided_by=?,reason=NULL,last_operation=?
        WHERE id=? AND version=? AND candidate_revision_id=? AND status IN ${EDITABLE}
        AND EXISTS(SELECT 1 FROM file_revisions WHERE id=? AND status='ready')`,now,now,actor,operation,id,version,revisionId,revisionId),
      statement(env,`INSERT INTO resources(id,course_id,type,title,semester,contributor,revision_id,status,published_at,updated_at,published_by)
        SELECT id,?,?,?,?,?,?,'published',?,?,? FROM submissions WHERE id=? AND last_operation=?
        ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id,type=excluded.type,title=excluded.title,semester=excluded.semester,
          contributor=excluded.contributor,revision_id=excluded.revision_id,status='published',updated_at=excluded.updated_at,published_by=excluded.published_by`,
        m.course_id,m.type,m.title,m.semester,m.contributor,revisionId,now,now,actor,id,operation),
      statement(env,`UPDATE file_revisions SET status='delete_pending',delete_after=CASE WHEN status='uploading' THEN upload_deadline ELSE ? END WHERE submission_id=? AND id<>? AND status IN ('ready','uploading')
        AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND last_operation=?)`,now,id,revisionId,id,operation),
      auditStatement(env,id,operation,current.status==='published'?'resource_modified':'submission_approved',actor,now),
    ]);
  } else if(['reject','unpublish','remove'].includes(action)) {
    const reason=text(body.reason,'reason',3,300);
    if(action==='reject') {
      const wasPublished=await statement(env,'SELECT id FROM resources WHERE id=?',id).first();
      if(wasPublished || !['pending','under_review'].includes(current.status)) throw new WorkerHttpError(409,'Use permanent removal for a previously published resource.');
    }
    if(action==='unpublish' && current.status!=='published') throw new WorkerHttpError(409,'Only published resources can be unpublished.');
    const target=action==='unpublish'?'unpublished':action==='reject'?'rejected':'removed';
    const isPermanent=action!=='unpublish';
    const statements=[
      statement(env,`UPDATE submissions SET status=?,version=version+1,updated_at=?,decision_at=?,decided_by=?,reason=?,last_operation=?
        ${isPermanent?",title='Removed material',semester='',contributor=NULL,contributor_sub=NULL,contributor_email=NULL,original_revision_id=NULL,candidate_revision_id=NULL":''}
        WHERE id=? AND version=? AND status IN ${EDITABLE}`,target,now,now,actor,reason,operation,id,version),
      statement(env,`UPDATE resources SET status=?,updated_at=? ${isPermanent?",title='Removed material',semester='',contributor=NULL,revision_id=NULL":''}
        WHERE id=? AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND last_operation=?)`,isPermanent?'removed':'unpublished',now,id,id,operation),
      auditStatement(env,id,operation,action==='reject'?'submission_rejected':action==='unpublish'?'resource_unpublished':'resource_removed',actor,now,reason),
    ];
    if(isPermanent) statements.push(statement(env,`UPDATE file_revisions SET status='delete_pending',delete_after=CASE WHEN status='uploading' THEN upload_deadline ELSE ? END,
      filename='removed',created_by=CASE WHEN created_by='contributor' THEN 'contributor' ELSE created_by END
      WHERE submission_id=? AND status<>'deleted' AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND last_operation=?)`,now,id,id,operation));
    await mutation(env,statements);
  } else throw new WorkerHttpError(404,'Unknown moderation action.');
  if(['approve','reject','remove'].includes(action)) await runPrivateCleanup(env).catch(()=>console.error(JSON.stringify({event:'private_cleanup_deferred'})));
  return json(await detail(env,id));
}

/** Bounded, idempotent durable retry worker. No public route can call this. */
export async function runPrivateCleanup(env: ModerationEnv, limit=5) {
  const now=iso();
  // An interrupted original upload never became a submission accepted for review.
  await env.DB.batch([
    statement(env,`UPDATE submissions SET status='rejected',title='Upload not completed',semester='',contributor=NULL,contributor_sub=NULL,contributor_email=NULL,
      reason='Upload not completed',updated_at=? WHERE status='receiving' AND created_at<?`,now,new Date(Date.now()-HOUR).toISOString()),
    statement(env,`UPDATE file_revisions SET status='delete_pending',delete_after=? WHERE status='uploading' AND upload_deadline<=?`,now,now),
  ]);
  // A delayed/ambiguous R2 PUT can outlive the first delete attempt. Reconcile
  // a bounded private prefix page forever, even after a revision is tombstoned.
  // Never infer permission to delete unknown objects; every deletion needs its
  // durable revision record and an explicit terminal/superseded decision.
  const scan=await statement(env,'SELECT cursor,version FROM cleanup_state WHERE singleton=1').first<{cursor:string|null;version:number}>();
  if(scan) {
    const objects=await env.PRIVATE_FILES.list({prefix:'private/v1/',limit:5,...(scan.cursor?{cursor:scan.cursor}:{})});
    for(const object of objects.objects) {
      const revision=await statement(env,'SELECT id,status FROM file_revisions WHERE object_key=?',object.key).first<{id:string;status:string}>();
      if(revision?.status==='deleted') {
        await statement(env,"UPDATE file_revisions SET status='delete_pending',delete_after=?,deleted_at=NULL WHERE id=? AND status='deleted'",now,revision.id).run();
      } else if(!revision) console.error(JSON.stringify({event:'private_unassociated_object_requires_review'}));
    }
    await statement(env,'UPDATE cleanup_state SET cursor=?,scanned_at=?,version=version+1 WHERE singleton=1 AND version=?',objects.truncated?(objects.cursor??null):null,now,scan.version).run();
  }
  const rows=await statement(env,`SELECT * FROM file_revisions WHERE status='delete_pending' AND delete_after<=?
    AND NOT EXISTS(SELECT 1 FROM resources WHERE revision_id=file_revisions.id AND status IN ('published','unpublished'))
    AND NOT EXISTS(SELECT 1 FROM submissions WHERE candidate_revision_id=file_revisions.id AND status IN ${EDITABLE})
    ORDER BY delete_after,id LIMIT ?`,now,Math.min(10,Math.max(1,limit))).all<Revision>();
  for(const revision of rows.results) {
    try {
      await env.PRIVATE_FILES.delete(revision.object_key);
      await statement(env,`UPDATE file_revisions SET status='deleted',filename='removed',etag=NULL,deleted_at=?,last_delete_error=NULL,
        delete_attempts=delete_attempts+1 WHERE id=? AND status='delete_pending'`,now,revision.id).run();
    } catch {
      await statement(env,`UPDATE file_revisions SET delete_attempts=delete_attempts+1,last_delete_error='storage_delete_failed',delete_after=?
        WHERE id=? AND status='delete_pending'`,new Date(Date.now()+5*60000).toISOString(),revision.id).run();
      console.error(JSON.stringify({event:'private_cleanup_retry',revision_id:revision.id}));
    }
  }
  return {processed:rows.results.length};
}

export default {
  async scheduled(_event: unknown, env: ModerationEnv) {
    if(env.CLEANUP_ENABLED==='true') await runPrivateCleanup(env);
  },
  async fetch(request: Request, env: ModerationEnv): Promise<Response> {
    let cors: Record<string,string>={};
    try {
      const url=new URL(request.url),adminOrigin=exactOrigin(env.ADMIN_ORIGIN),publicOrigin=exactOrigin(env.PUBLIC_API_ORIGIN);
      if(adminOrigin===publicOrigin) throw new WorkerHttpError(503,'Server origins must be distinct.');
      if(url.origin===adminOrigin) {
        const actor=await authorizeAdmin(request,env);
        if(url.pathname==='/admin/api/session' && request.method==='GET') return json({email:actor});
        if(url.pathname==='/admin/api/courses' && request.method==='GET') return json({courses});
        if(url.pathname==='/admin/api/submissions' && request.method==='GET') return await listAdmin(url,env);
        if(url.pathname==='/admin/api/cleanup' && request.method==='POST') {await readJSON(request);return json(await runPrivateCleanup(env));}
        const match=/^\/admin\/api\/submissions\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
        if(match) {
          const [,id,action]=match;assertId(id);
          if(!action && request.method==='GET') return json(await detail(env,id));
          if(action?.startsWith('files/') && ['GET','HEAD'].includes(request.method)) return await adminFile(request,env,id,action.slice(6));
          if(action==='revisions' && request.method==='POST') return await replaceFile(request,env,actor,id);
          if(action && request.method==='POST') return await adminAction(request,env,actor,id,action);
          throw new WorkerHttpError(405,'Method not allowed.');
        }
        if(url.pathname.startsWith('/admin/api/')) throw new WorkerHttpError(404,'Endpoint not found.');
        if(!['GET','HEAD'].includes(request.method)) throw new WorkerHttpError(405,'Method not allowed.');
        const asset=await env.ASSETS.fetch(request);
        const headers=new Headers(asset.headers);
        for(const [key,value] of Object.entries(PRIVATE_HEADERS)) headers.set(key,value);
        headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' ${publicOrigin}; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
        return new Response(asset.body,{status:asset.status,headers});
      }
      if(url.origin!==publicOrigin || url.pathname.startsWith('/admin')) throw new WorkerHttpError(404,'Endpoint not found.');
      if(request.method==='GET' && url.pathname==='/resources') {cors={'Access-Control-Allow-Origin':'*'};return await listPublic(url,env);}
      const fileMatch=/^\/download\/([^/]+)$/.exec(url.pathname);
      if(fileMatch && ['GET','HEAD'].includes(request.method)) {cors={'Access-Control-Allow-Origin':'*'};return await download(request,env,fileMatch[1]);}
      if(!['/submit','/auth/verify'].includes(url.pathname)) throw new WorkerHttpError(404,'Endpoint not found.');
      const allowed=env.ALLOWED_ORIGIN.split(',').map(x=>exactOrigin(x.trim()));
      const origin=request.headers.get('Origin');
      if(!origin || !allowed.includes(origin)) throw new WorkerHttpError(403,'Origin is not permitted.');
      cors={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
      if(request.method==='OPTIONS') return json({success:true},200,cors);
      if(request.method!=='POST') throw new WorkerHttpError(405,'Method not allowed.');
      if(url.pathname==='/auth/verify') {await verifyGoogleStudentToken(request,env);return json({success:true,authorized:true},200,cors);}
      const response=await submission(request,env);
      for(const [key,value] of Object.entries(cors)) response.headers.set(key,value);
      return response;
    } catch(error) {
      if(error instanceof WorkerHttpError) return json({success:false,error:error.clientMessage},error.status,cors);
      console.error(JSON.stringify({event:'private_moderation_request_failed'}));
      return json({success:false,error:'The service could not complete this operation. Reload the record before retrying.'},503,cors);
    }
  },
};
