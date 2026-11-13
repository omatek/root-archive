import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';

// Real local workerd, D1 and R2 emulation. Google, Access and Turnstile are
// signed/offline fixtures; no request may reach a real third-party service.
const moderationConfig=JSON.parse(readFileSync(new URL('../wrangler.moderation.jsonc',import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,''));
// Exercise the configured hostname in local workerd; outbound identity calls stay mocked.
const adminOrigin = moderationConfig.vars.ADMIN_ORIGIN;
const publicOrigin = 'https://api.example.invalid';
const studentOrigin = 'https://archive.example.invalid';
const issuer = 'https://fixture.cloudflareaccess.com';
const actor = 'root@example.invalid';
const studentEmail = 'synthetic@std.aum.edu.jo';
const course = JSON.parse(readFileSync(new URL('../../site/courses.json', import.meta.url)))[0];
const {privateKey, publicKey} = await generateKeyPair('RS256');
const {privateKey: wrongKey} = await generateKeyPair('RS256');
const jwks = {keys:[{...await exportJWK(publicKey), kid:'moderation-fixture', alg:'RS256', use:'sig'}]};
const baseBindings = {
  ADMIN_ORIGIN:adminOrigin, PUBLIC_API_ORIGIN:publicOrigin, ALLOWED_ORIGIN:studentOrigin,
  ACCESS_ISSUER:issuer, ACCESS_AUD:'synthetic-admin-app', ADMIN_EMAILS:actor,
  GOOGLE_CLIENT_ID:'synthetic-google-app', TURNSTILE_SECRET:'synthetic-turnstile',
  SUBMISSIONS_ENABLED:'true', CLEANUP_ENABLED:'true',
};
let mf, db, bucket, turnstileSuccess=true;
let outbound=[];
const sign = (claims={}, key=privateKey) => new SignJWT({iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+3600,
  sub:'synthetic-identity', ...claims}).setProtectedHeader({alg:'RS256',kid:'moderation-fixture'}).sign(key);
const adminToken = (patch={}, key) => sign({iss:issuer,aud:baseBindings.ACCESS_AUD,email:actor,...patch},key);
const studentToken = (patch={}, key) => sign({iss:'https://accounts.google.com',aud:baseBindings.GOOGLE_CLIENT_ID,
  email:studentEmail,hd:'std.aum.edu.jo',email_verified:true,...patch},key);
async function dispatch(request) {
  const body = ['GET','HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  return mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body});
}
async function admin(path, {method='GET',body,jwt,headers={}}={}) {
  const requestHeaders = {'Cf-Access-Jwt-Assertion':jwt ?? await adminToken(),...headers};
  if (!['GET','HEAD'].includes(method)) Object.assign(requestHeaders,{Origin:adminOrigin,'X-Requested-With':'root-admin'});
  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders['Content-Type']='application/json'; body=JSON.stringify(body);
  }
  return dispatch(new Request(`${adminOrigin}${path}`,{method,headers:requestHeaders,body}));
}
const read = async response => {
  assert.equal(response.status,200,await response.clone().text());
  return response.json();
};
const form = (patch={}) => {
  const data = new FormData();
  for (const [k,v] of Object.entries({course_id:course.id,type:'Summary',title:'Synthetic academic material',semester:'Fall 2026',
    turnstile_token:'synthetic-challenge',file:new File(['%PDF-original'], 'original.pdf',{type:'application/pdf'}),...patch})) {
    if(v !== undefined) data.set(k,v);
  }
  return data;
};
async function submit(patch={}, jwt) {
  return dispatch(new Request(`${publicOrigin}/submit`,{method:'POST',headers:{Origin:studentOrigin,
    Authorization:`Bearer ${jwt ?? await studentToken()}`},body:form(patch)}));
}
async function create(patch={}) {
  const response=await submit(patch);
  assert.equal(response.status,201,await response.clone().text());
  const result=await response.json();
  assert.deepEqual(Object.keys(result).sort(),['submission_id','success']);
  assert.match(result.submission_id,/^[a-f0-9-]{36}$/);
  return read(await admin(`/admin/api/submissions/${result.submission_id}`));
}
async function action(record, name, patch={}) {
  const s=record.submission;
  return admin(`/admin/api/submissions/${s.id}/${name}`,{method:'POST',body:{version:s.version,...patch}});
}
const publicDownload = (id,method='GET') => dispatch(new Request(`${publicOrigin}/download/${id}`,{method}));
const publicCatalog = async () => read(await dispatch(new Request(`${publicOrigin}/resources`)));
async function cleanup() {return read(await admin('/admin/api/cleanup',{method:'POST',body:{}}));}
async function replacement(record, bytes='%PDF-cleaned', name='cleaned.pdf', mime='application/pdf') {
  const data = new FormData(); data.set('version',String(record.submission.version));
  data.set('file',new File([bytes],name,{type:mime}));
  return admin(`/admin/api/submissions/${record.submission.id}/revisions`,{method:'POST',body:data});
}

// A new isolated local store per file; all tests in this file run serially.
test.before(async () => {
  mf=new Miniflare(convertV4MiniflareOptions({unsafeTriggerHandlers:true,workers:[{
    name:'moderation', modules:true,
    scriptPath:new URL('../.wrangler/moderation-dist/moderation.js',import.meta.url).pathname,
    compatibilityDate:moderationConfig.compatibility_date, bindings:baseBindings,
    d1Databases:{DB:'local-private-moderation'},r2Buckets:{PRIVATE_FILES:'local-private-files'},
    serviceBindings:{ASSETS:async () => new MiniflareResponse('<!doctype html><title>Private portal fixture</title>',{headers:{'Content-Type':'text/html'}})},
    outboundService:async request => {
      const url=new URL(request.url); outbound.push(url.origin+url.pathname);
      if(url.href===`${issuer}/cdn-cgi/access/certs` || url.href==='https://www.googleapis.com/oauth2/v3/certs') {
        return new MiniflareResponse(JSON.stringify(jwks),{headers:{'Content-Type':'application/json'}});
      }
      if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        assert.equal(request.method,'POST');
        const data=new URLSearchParams(await request.text());
        assert.equal(data.get('secret'),baseBindings.TURNSTILE_SECRET);
        return new MiniflareResponse(JSON.stringify({success:turnstileSuccess}),{headers:{'Content-Type':'application/json'}});
      }
      throw new Error(`Unexpected external request: ${url.origin}${url.pathname}`);
    },
  }]}));
  db=await mf.getD1Database('DB'); bucket=await mf.getR2Bucket('PRIVATE_FILES');
  for (const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) {
    const migration=readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').replace(/^\s*--.*$/gm,'');
    // Trigger bodies stay on one line; only statement-ending newlines split SQL.
    for(const sql of migration.split(/;\s*(?:\n|$)/).map(x=>x.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
});
test.beforeEach(async () => {
  await db.batch(['DELETE FROM moderation_audit','DELETE FROM resources','DELETE FROM file_revisions','DELETE FROM submissions'].map(sql=>db.prepare(sql)));
  await db.prepare('UPDATE cleanup_state SET cursor=NULL,version=1 WHERE singleton=1').run();
  const listed=await bucket.list();
  if(listed.objects.length) await bucket.delete(listed.objects.map(o=>o.key));
  turnstileSuccess=true;outbound=[];
});
test.after(async () => {await mf?.dispose();});

test('all admin API, static, file and alternate-host boundaries independently require Access and allowlist authorization',async () => {
  const paths=['/','/index.html','/styles.css','/js/admin.mjs','/js/image-editor.mjs',
    '/assets/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2','/admin/api/session',
    '/admin/api/courses','/admin/api/submissions','/admin/api/submissions/12345678-1234-4123-8123-123456789abc',
    '/admin/api/submissions/12345678-1234-4123-8123-123456789abc/files/12345678-1234-4123-8123-123456789abc'];
  for(const path of paths) for(const method of ['GET','HEAD']) {
    const response=await dispatch(new Request(adminOrigin+path,{method}));
    assert.equal(response.status,401,`${path}: ${await response.text()}`);
    assert.match(response.headers.get('Cache-Control'),/no-store/);
  }
  const valid=await adminToken();
  for(const host of [publicOrigin,'https://moderation.workers.dev','https://preview.pages.dev',
    'https://admin.rootamman.com','https://admin-staging.rootamman.com',adminOrigin+'.attacker.invalid']) for(const path of paths) {
    const denied=await dispatch(new Request(host+path,{headers:{'Cf-Access-Jwt-Assertion':valid}}));
    assert.equal(denied.status,404);
  }
  const now=Math.floor(Date.now()/1000);
  for(const jwt of [
    await adminToken({exp:now-60}),await adminToken({aud:'another-app'}),await adminToken({iss:'https://attacker.cloudflareaccess.com'}),
    await adminToken({iat:now+3600}),await adminToken({iat:now-90000}),await adminToken({},wrongKey),
    await studentToken(), 'a.b.c',
  ]) assert.equal((await admin('/admin/api/session',{jwt})).status,401);
  assert.equal((await admin('/admin/api/session',{jwt:await adminToken({email:studentEmail})})).status,403);
  assert.deepEqual(await read(await admin('/admin/api/session')),{email:actor});
  const staticResponse=await admin('/'); assert.equal(staticResponse.status,200);
  assert.match(staticResponse.headers.get('Content-Security-Policy'),/object-src 'none'/);
  assert.equal(staticResponse.headers.get('Access-Control-Allow-Origin'),null);
  const certRequests = outbound.filter(url => url === `${issuer}/cdn-cgi/access/certs`).length;
  assert.ok(certRequests > 0, 'the public verification keys were retrieved');
  assert.equal((await admin('/admin/api/session')).status,200);
  assert.equal((await admin('/admin/api/session',{jwt:await adminToken({email:studentEmail})})).status,403);
  assert.equal((await admin('/admin/api/session',{jwt:await adminToken({exp:now-60})})).status,401);
  assert.equal(outbound.filter(url => url === `${issuer}/cdn-cgi/access/certs`).length,certRequests,
    'cached public keys avoid repeated cert fetches without caching identity or authorization');
});

test('configured administrator hostname fails closed until issuer, audience and explicit allowlist are complete',async () => {
  for(const overrides of [{ADMIN_EMAILS:''},{ADMIN_EMAILS:'*'},{ACCESS_ISSUER:''},{ACCESS_AUD:''}]) {
    for(const path of ['/','/js/admin.mjs','/admin/api/session']) {
      const response=await invokeNode(new Request(adminOrigin+path),overrides);
      assert.equal(response.status,503);
      assert.match(response.headers.get('Cache-Control'),/no-store/);
    }
  }
});

test('CSRF rejects foreign origins, missing custom headers and cross-site browser requests',async () => {
  const jwt=await adminToken();
  for(const headers of [
    {Origin:'https://attacker.invalid','X-Requested-With':'root-admin'},
    {Origin:adminOrigin},
    {'X-Requested-With':'root-admin'},
    {Origin:adminOrigin,'X-Requested-With':'root-admin','Sec-Fetch-Site':'cross-site'},
  ]) {
    const response=await dispatch(new Request(adminOrigin+'/admin/api/cleanup',{method:'POST',headers:{
      'Cf-Access-Jwt-Assertion':jwt,'Content-Type':'application/json',...headers},body:'{}'}));
    assert.equal(response.status,403);
  }
  assert.equal((await dispatch(new Request(publicOrigin+'/admin/api/cleanup',{method:'OPTIONS',headers:{Origin:adminOrigin}}))).status,404);
});

test('student submission requires signed eligible Google identity, exact origin and successful Turnstile',async () => {
  assert.equal((await dispatch(new Request(publicOrigin+'/submit',{method:'POST',headers:{Origin:studentOrigin},body:form()}))).status,401);
  for(const patch of [{email:'synthetic@gmail.com'},{hd:'aum.edu.jo'},{email_verified:false},{aud:'wrong'},
    {exp:Math.floor(Date.now()/1000)-60}]) {
    assert.ok([401,403].includes((await submit({},await studentToken(patch))).status));
  }
  const foreign=await dispatch(new Request(publicOrigin+'/submit',{method:'POST',headers:{Origin:'https://attacker.invalid',
    Authorization:`Bearer ${await studentToken()}`},body:form()}));
  assert.equal(foreign.status,403);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,0);
  turnstileSuccess=false; assert.equal((await submit()).status,403);turnstileSuccess=true;
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,0);
  assert.deepEqual((await publicCatalog()).resources,[]);
  for(const file of [new File(['%PDF-no'],'x.exe',{type:'application/pdf'}),new File(['bad'],'x.pdf',{type:'application/pdf'}),
    new File(['%PDF-no'],'x.pdf',{type:'text/html'})]) assert.equal((await submit({file})).status,400);
  for(const patch of [{title:'<script>x</script>'},{title:'line\nbreak'},{course_id:'9999999'},{type:'Past Paper'}]) assert.equal((await submit(patch)).status,400);
  const accepted=await create({semester:undefined});assert.equal(accepted.submission.semester,'');
  assert.equal(outbound.some(x=>x.includes('github.com')),false,'private path never creates a PR');
});

test('pending and replacement revisions stay private; only selected approved snapshot appears anonymously',async () => {
  let record=await create();const id=record.submission.id;
  assert.equal(record.submission.status,'pending');assert.equal(record.submission.contributor_email,studentEmail);
  assert.equal((await publicDownload(id)).status,404);assert.deepEqual((await publicCatalog()).resources,[]);
  const revision=record.revisions[0];
  assert.equal(revision.id,record.submission.original_revision_id);assert.equal(revision.status,'ready');
  for(const host of [publicOrigin,'https://moderation.workers.dev']) {
    assert.equal((await dispatch(new Request(host+`/admin/api/submissions/${id}/files/${revision.id}`))).status,404);
  }
  assert.equal((await dispatch(new Request(adminOrigin+`/admin/api/submissions/${id}/files/${revision.id}`))).status,401);
  const original=await admin(`/admin/api/submissions/${id}/files/${revision.id}`);
  assert.equal(original.status,200);assert.equal(await original.text(),'%PDF-original');
  assert.match(original.headers.get('Content-Disposition'),/^attachment/);
  assert.match(original.headers.get('Content-Security-Policy'),/sandbox/);
  record=await read(await action(record,'review'));assert.equal(record.submission.status,'under_review');
  record=await read(await action(record,'metadata',{course_id:course.id,type:'Notes',title:'Cleaned academic material',semester:'',contributor:null}));
  record=await read(await replacement(record));
  assert.notEqual(record.submission.candidate_revision_id,record.submission.original_revision_id);
  assert.equal((await publicDownload(id)).status,404);
  const publishVersion=record.submission.version;
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  assert.equal(record.submission.status,'published');
  assert.equal(record.submission.version,publishVersion+1);
  const resources=(await publicCatalog()).resources;assert.equal(resources.length,1);
  assert.deepEqual(Object.keys(resources[0]).sort(),['asset_url','contributor','course_id','created_at','id','semester','title','type']);
  assert.equal(resources[0].asset_url,`${publicOrigin}/download/${id}`);
  assert.equal(JSON.stringify(resources).includes(studentEmail),false);
  assert.equal(JSON.stringify(resources).includes('private/v1/'),false);
  const download=await publicDownload(id);assert.equal(download.status,200);assert.equal(await download.text(),'%PDF-cleaned');
  assert.equal(download.headers.get('Content-Type'),'application/pdf');
  for(const header of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control']) assert.match(download.headers.get(header),/no-store/);
  assert.equal(download.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(download.headers.get('Access-Control-Allow-Origin'),'*');
  assert.equal((await publicDownload(id,'HEAD')).status,200);
  const retry=await admin(`/admin/api/submissions/${id}/approve`,{method:'POST',body:{version:publishVersion,revision_id:record.submission.candidate_revision_id}});
  assert.equal(retry.status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM moderation_audit WHERE action='submission_approved'").first()).n,1);
  assert.ok(record.audit.some(a=>a.action==='file_replaced' && a.actor===actor));
  await cleanup();
  assert.equal((await bucket.list()).objects.length,1,'unnecessary original is deleted after selected revision publication');
});

test('F-01 anonymous GET/HEAD use only resource identity and trusted extension, never source filenames',async () => {
  const formats=[['pdf','application/pdf','%PDF-private'],['png','image/png',new Uint8Array([137,80,78,71,13,10,26,10])],
    ['jpg','image/jpeg',new Uint8Array([255,216,255])],['zip','application/zip',new Uint8Array([80,75,3,4])],
    ['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',new Uint8Array([80,75,3,4])]];
  for(const [ext,mime,bytes] of formats) {
    const originalName=`Synthetic-Student-123456-private-name.${ext}`;
    let record=await create({file:new File([bytes],originalName,{type:mime})});
    const id=record.submission.id,originalRevision=record.submission.candidate_revision_id;
    assert.equal(record.submission.contributor,null);
    assert.ok((await admin(`/admin/api/submissions/${id}/files/${originalRevision}`)).headers.get('Content-Disposition').includes(originalName));
    async function checkPublic() {
      for(const method of ['GET','HEAD']) {
        const response=await publicDownload(id,method);assert.equal(response.status,200);
        assert.equal(response.headers.get('Content-Disposition'),`attachment; filename="resource-${id}.${ext}"`);
        assert.equal(response.headers.get('Content-Type'),mime);
        assert.match(response.headers.get('Cache-Control'),/no-store/);
        assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
        assert.doesNotMatch(JSON.stringify([...response.headers]),/Synthetic-Student|123456-private|replacement-name|private\/v1/);
      }
    }
    record=await read(await action(record,'approve',{revision_id:originalRevision}));await checkPublic();
    record=await read(await action(record,'unpublish',{reason:'Private correction'}));
    for(const method of ['GET','HEAD']) assert.equal((await publicDownload(id,method)).status,404);
    record=await read(await replacement(record,bytes,`replacement-name-987654.${ext}`,mime));
    record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));await checkPublic();
  }
});

test('F-02 catalog generations reject mixed pages and restart to a complete, parseable live catalog',async () => {
  const {loadPublishedResources,parseCatalog}=await import('../../site/js/catalog.mjs');
  const ids=[];
  async function seed(n,date='2026-01-01T00:00:00.000Z') {
    const id=`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
    await db.batch([
      db.prepare(`INSERT INTO submissions(id,course_id,type,title,semester,status,created_at,updated_at,last_operation)
        VALUES(?,?,'Summary','Synthetic material','','published',?,?,?)`).bind(id,course.id,date,date,id),
      db.prepare(`INSERT INTO resources(id,course_id,type,title,semester,status,published_at,updated_at,published_by)
        VALUES(?,?,'Summary','Synthetic material','','published',?,?,'synthetic')`).bind(id,course.id,date,date),
    ]);return id;
  }
  for(let n=1;n<=205;n++) ids.push(await seed(n));
  const initial=await publicCatalog();assert.equal(initial.resources.length,200);
  assert.match(initial.next_cursor,/^[A-Za-z0-9_-]+$/);assert.notEqual(initial.next_cursor,'200');
  await seed(300,'2026-11-01T00:00:00.000Z');
  const stale=await dispatch(new Request(`${publicOrigin}/resources?cursor=${initial.next_cursor}`));
  assert.equal(stale.status,409);assert.equal((await stale.json()).code,'catalog_changed');
  const originalFetch=globalThis.fetch;
  async function traversal(mutate) {
    let first=true,restarts=0;
    globalThis.fetch=async value=>{
      const response=await dispatch(new Request(value));
      if(response.status===409) restarts++;
      if(first){first=false;await mutate();}
      return response;
    };
    const resources=await loadPublishedResources(publicOrigin+'/resources');
    assert.equal(restarts,1);
    const expected=await db.prepare("SELECT id FROM resources WHERE status='published' ORDER BY published_at DESC,id").all();
    assert.deepEqual(resources.map(r=>r.id),expected.results.map(r=>r.id));
    assert.equal(new Set(resources.map(r=>r.id)).size,resources.length);
    assert.equal(parseCatalog([course],resources,{allowEmptySemester:true,downloadOrigin:publicOrigin}).resourceCount,resources.length);
  }
  try {
    await traversal(()=>seed(301,'2026-12-01T00:00:00.000Z'));
    for(const id of [ids[0],ids.at(-1)]) await traversal(()=>db.prepare("UPDATE resources SET status='unpublished' WHERE id=?").bind(id).run());
    await traversal(()=>db.prepare('DELETE FROM resources WHERE id=?').bind(ids[1]).run());
  } finally {globalThis.fetch=originalFetch;}
  // All seeded timestamps tie: an unchanged generation still terminates exactly.
  for(const cursor of ['200','bad!','a'.repeat(513),btoa(JSON.stringify([1,'0'.repeat(32),-200,'']))]) {
    assert.equal((await dispatch(new Request(`${publicOrigin}/resources?cursor=${encodeURIComponent(cursor)}`))).status,400);
  }
  const first=await publicCatalog();
  assert.equal((await dispatch(new Request(`${publicOrigin}/resources?course_id=${course.id}&cursor=${first.next_cursor}`))).status,400);
});

test('published replacement preserves old file until approval; unpublish revokes stable URLs and returns private re-review',async () => {
  let record=await create();const id=record.submission.id;
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  const stable=record.published.asset_url;const initialRevision=record.published.revision_id;
  record=await read(await replacement(record,'%PDF-second','second.pdf'));
  record=await read(await action(record,'metadata',{course_id:course.id,type:'Notes',title:'A corrected title',semester:'Fall 2026',contributor:null}));
  assert.equal(await (await publicDownload(id)).text(),'%PDF-original');
  assert.equal((await publicCatalog()).resources[0].title,'Synthetic academic material');
  await cleanup();assert.ok(await bucket.head((await db.prepare('SELECT object_key FROM file_revisions WHERE id=?').bind(initialRevision).first()).object_key));
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  assert.equal(await (await publicDownload(id)).text(),'%PDF-second');
  assert.equal((await publicCatalog()).resources[0].title,'A corrected title');
  record=await read(await action(record,'unpublish',{reason:'Correctable scan issue'}));
  assert.equal(record.submission.status,'unpublished');assert.equal(record.published.status,'unpublished');
  assert.equal(record.published.asset_url,stable);assert.equal((await publicDownload(id)).status,404);
  assert.deepEqual((await publicCatalog()).resources,[]);
  await cleanup();
  const kept=record.revisions.find(r=>r.id===record.submission.candidate_revision_id);
  assert.equal((await admin(`/admin/api/submissions/${id}/files/${kept.id}`)).status,200);
  const queue=await read(await admin('/admin/api/submissions?view=pending'));assert.equal(queue.submissions[0].id,id);
  record=await read(await action(record,'review'));
  assert.equal((await action(record,'reject',{reason:'Use permanent removal for a previously published resource'})).status,409);
  record=await read(await replacement(record,'%PDF-third','third.pdf'));
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  assert.equal(record.published.asset_url,stable);assert.equal(await (await publicDownload(id)).text(),'%PDF-third');
  record=await read(await action(record,'remove',{reason:'Permanent privacy removal'}));
  assert.equal(record.submission.status,'removed');assert.equal(record.submission.contributor_email,null);
  assert.equal(record.submission.contributor_sub,null);assert.equal(record.submission.title,'Removed material');
  assert.equal(record.published.revision_id,null);assert.equal((await publicDownload(id)).status,404);
  assert.deepEqual((await publicCatalog()).resources,[]);
  for(const r of record.revisions) assert.equal((await admin(`/admin/api/submissions/${id}/files/${r.id}`)).status,404);
  await cleanup();await cleanup();assert.equal((await bucket.list()).objects.length,0);
  assert.equal((await action(record,'approve',{revision_id:kept.id})).status,409);
  const history=await read(await admin('/admin/api/submissions?view=history'));assert.equal(history.submissions[0].id,id);
});

test('rejection destroys pending files, retains minimal decision, and cannot be reversed by stale approval',async () => {
  let record=await create({contributor:'Synthetic credit'});const stale=record;const id=record.submission.id;
  record=await read(await replacement(record));
  record=await read(await action(record,'reject',{reason:'Submission not suitable'}));
  assert.equal(record.submission.status,'rejected');assert.equal(record.submission.contributor,null);
  assert.equal(record.submission.contributor_email,null);assert.equal(record.submission.reason,'Submission not suitable');
  assert.equal((await action(stale,'approve',{revision_id:stale.submission.candidate_revision_id})).status,409);
  assert.equal((await publicDownload(id)).status,404);
  await cleanup();assert.equal((await bucket.list()).objects.length,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM resources').first()).n,0);
  assert.ok(record.audit.some(a=>a.action==='submission_rejected'&&a.actor===actor));
});

test('concurrent approvals and conflicting decisions cannot duplicate or resurrect publication',async () => {
  let record=await create();const id=record.submission.id;
  const approvals=await Promise.all([action(record,'approve',{revision_id:record.submission.candidate_revision_id}),
    action(record,'approve',{revision_id:record.submission.candidate_revision_id})]);
  assert.ok(approvals.some(r=>r.status===200));
  for(const response of approvals) assert.ok([200,409].includes(response.status),await response.clone().text());
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM resources WHERE id=?').bind(id).first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM moderation_audit WHERE submission_id=? AND action='submission_approved'").bind(id).first()).n,1);
  record=await read(await admin(`/admin/api/submissions/${id}`));
  const stale=record;
  record=await read(await action(record,'unpublish',{reason:'Scan needs correction'}));
  assert.equal((await action(stale,'approve',{revision_id:stale.submission.candidate_revision_id})).status,409);
  assert.equal((await publicDownload(id)).status,404);
  const decisions=await Promise.all([action(record,'approve',{revision_id:record.submission.candidate_revision_id}),action(record,'remove',{reason:'Permanent takedown'})]);
  assert.deepEqual(decisions.map(r=>r.status).sort(),[200,409]);
  const current=await read(await admin(`/admin/api/submissions/${id}`));
  if(current.submission.status==='removed') assert.equal((await publicDownload(id)).status,404);
  else {assert.equal(current.submission.status,'published');assert.equal((await publicDownload(id)).status,200);}
});

test('missing candidate bytes and interrupted D1 publication never produce a public resource',async () => {
  let record=await create();const id=record.submission.id;
  const file=await db.prepare('SELECT * FROM file_revisions WHERE id=?').bind(record.submission.candidate_revision_id).first();
  await bucket.delete(file.object_key);
  assert.equal((await action(record,'approve',{revision_id:file.id})).status,409);
  assert.equal((await publicDownload(id)).status,404);assert.deepEqual((await publicCatalog()).resources,[]);
  // Replace successfully, then abort inside D1's atomic batch after the guarded
  // submission UPDATE. Neither the state, audit nor resource insert may commit.
  record=await read(await replacement(record));
  const generationBefore=(await db.prepare('SELECT generation FROM catalog_state').first()).generation;
  // Abort after the resource insert and its generation trigger have executed.
  await db.prepare("CREATE TRIGGER fixture_fail_publish BEFORE INSERT ON moderation_audit WHEN NEW.action='submission_approved' BEGIN SELECT RAISE(ABORT, 'synthetic_database_failure'); END").run();
  try {
    assert.equal((await action(record,'approve',{revision_id:record.submission.candidate_revision_id})).status,503);
    const unchanged=await read(await admin(`/admin/api/submissions/${id}`));
    assert.equal(unchanged.submission.version,record.submission.version);assert.equal(unchanged.submission.status,'pending');
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM moderation_audit WHERE action='submission_approved'").first()).n,0);
    assert.equal((await db.prepare('SELECT generation FROM catalog_state').first()).generation,generationBefore);
    assert.equal((await publicDownload(id)).status,404);assert.deepEqual((await publicCatalog()).resources,[]);
  } finally {await db.prepare('DROP TRIGGER fixture_fail_publish').run();}
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  assert.equal(record.submission.status,'published');assert.equal((await publicDownload(id)).status,200);
});

test('withdrawal during storage access still revokes an in-flight public response',async()=>{
  let record=await create();record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  let pause,release;const paused=new Promise(resolve=>pause=resolve),continued=new Promise(resolve=>release=resolve);
  const wrapped=new Proxy(bucket,{get(target,key){
    if(key==='get')return async(...args)=>{const object=await target.get(...args);pause();await continued;return object;};
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  const pending=invokeNode(new Request(`${publicOrigin}/download/${record.submission.id}`),{PRIVATE_FILES:wrapped});
  await paused;await read(await action(record,'unpublish',{reason:'Synthetic withdrawal during storage read'}));release();
  assert.equal((await pending).status,404);
});

test('replacement MIME/signature/size validation keeps current approved snapshot intact',async () => {
  let record=await create();const id=record.submission.id;
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  for(const args of [['invalid','invalid.pdf','application/pdf'],['%PDF-bad','bad.svg','image/svg+xml'],['%PDF-bad','bad.pdf','text/html']]) {
    assert.equal((await replacement(record,...args)).status,400);
    assert.equal(await (await publicDownload(id)).text(),'%PDF-original');
  }
  const huge=new FormData();huge.set('version',String(record.submission.version));
  huge.set('file',new File([new Uint8Array(25*1024*1024)],'large.pdf',{type:'application/pdf'}));
  // Exercise the actual bounded parser without the local HTTP bridge: an early
  // 413 while undici is still writing 25 MiB can otherwise surface as EPIPE.
  // D1/R2 remain real local bindings; external auth uses signed fixtures.
  const tooLarge=await invokeNode(new Request(`${adminOrigin}/admin/api/submissions/${id}/revisions`,{method:'POST',
    headers:{Origin:adminOrigin,'X-Requested-With':'root-admin','Cf-Access-Jwt-Assertion':await adminToken()},body:huge}));
  assert.equal(tooLarge.status,413);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_revisions WHERE submission_id=?').bind(id).first()).n,1);
});

test('interrupted uploads are discoverable and cleanup retries are durable and idempotent',async () => {
  const record=await create();const id=record.submission.id;
  const original=await db.prepare('SELECT * FROM file_revisions WHERE submission_id=?').bind(id).first();
  await db.batch([
    db.prepare("UPDATE submissions SET status='receiving',original_revision_id=NULL,candidate_revision_id=NULL,created_at=? WHERE id=?").bind('2020-01-01T00:00:00.000Z',id),
    db.prepare("UPDATE file_revisions SET status='uploading',upload_deadline=? WHERE id=?").bind('2020-01-01T00:00:00.000Z',original.id),
  ]);
  // Call the exported cleanup function with real emulated D1 and a failing R2
  // adapter; publication/auth behavior above runs through workerd unmodified.
  const {runPrivateCleanup}=await import('../.wrangler/moderation-dist/moderation.js');
  await runPrivateCleanup({...baseBindings,DB:db,PRIVATE_FILES:{list:bucket.list.bind(bucket),delete:async()=>{throw new Error('synthetic_delete_failure');}}});
  let row=await db.prepare('SELECT * FROM file_revisions WHERE id=?').bind(original.id).first();
  assert.equal(row.status,'delete_pending');assert.equal(row.delete_attempts,1);assert.equal(row.last_delete_error,'storage_delete_failed');
  const terminal=await db.prepare('SELECT * FROM submissions WHERE id=?').bind(id).first();
  assert.equal(terminal.status,'rejected');assert.equal(terminal.contributor_email,null);
  assert.ok(await bucket.head(original.object_key));assert.equal((await publicDownload(id)).status,404);
  await db.prepare('UPDATE file_revisions SET delete_after=? WHERE id=?').bind('2020-01-01T00:00:00.000Z',row.id).run();
  await cleanup();row=await db.prepare('SELECT * FROM file_revisions WHERE id=?').bind(row.id).first();
  assert.equal(row.status,'deleted');assert.equal(row.last_delete_error,null);assert.equal(await bucket.head(original.object_key),null);
  await cleanup();assert.equal((await db.prepare('SELECT delete_attempts FROM file_revisions WHERE id=?').bind(row.id).first()).delete_attempts,2);
});


test('a late R2 PUT after terminal cleanup is reconciled and deleted again without restoring public access',async () => {
  let record=await create();const id=record.submission.id;
  const file=await db.prepare('SELECT * FROM file_revisions WHERE submission_id=?').bind(id).first();
  record=await read(await action(record,'remove',{reason:'Permanent takedown'}));
  await cleanup();assert.equal(await bucket.head(file.object_key),null);
  assert.equal((await db.prepare('SELECT status FROM file_revisions WHERE id=?').bind(file.id).first()).status,'deleted');
  // Simulate an ambiguous pre-removal PUT completing after an initial DELETE.
  await bucket.put(file.object_key,'%PDF-delayed-original');
  assert.equal((await publicDownload(id)).status,404);
  await cleanup();assert.equal(await bucket.head(file.object_key),null);
  assert.equal((await publicDownload(id)).status,404);
  assert.equal((await db.prepare('SELECT status FROM submissions WHERE id=?').bind(id).first()).status,'removed');
});

async function invokeNode(request, overrides={}) {
  const {default:worker}=await import('../.wrangler/moderation-dist/moderation.js');
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (input) => {
    const url=new URL(input instanceof Request?input.url:input);
    if(url.href===`${issuer}/cdn-cgi/access/certs` || url.href==='https://www.googleapis.com/oauth2/v3/certs') return Response.json(jwks);
    if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify') return Response.json({success:true});
    throw new Error('Unexpected Node fixture network request');
  };
  try {return await worker.fetch(request,{...baseBindings,DB:db,PRIVATE_FILES:bucket,...overrides});}
  finally {globalThis.fetch=originalFetch;}
}

test('R2 PUT and post-PUT D1 failures leave no public bytes and preserve the prior approved replacement',async () => {
  let record=await create();const id=record.submission.id;
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  const data=new FormData();data.set('version',String(record.submission.version));
  data.set('file',new File(['%PDF-should-not-publish'],'failed.pdf',{type:'application/pdf'}));
  const failed=await invokeNode(new Request(`${adminOrigin}/admin/api/submissions/${id}/revisions`,{method:'POST',
    headers:{Origin:adminOrigin,'X-Requested-With':'root-admin','Cf-Access-Jwt-Assertion':await adminToken()},body:data}),
    {PRIVATE_FILES:new Proxy(bucket,{get(target,key){if(key==='put') return async()=>{throw new Error('synthetic_put_failure');};
      const value=target[key];return typeof value==='function'?value.bind(target):value;}})});
  assert.equal(failed.status,502,await failed.clone().text());
  const unchanged=await read(await admin(`/admin/api/submissions/${id}`));
  assert.equal(unchanged.submission.version,record.submission.version);
  assert.equal(unchanged.published.revision_id,record.published.revision_id);
  assert.equal(await (await publicDownload(id)).text(),'%PDF-original');

  let batches=0;
  const injectedDB=new Proxy(db,{get(target,key){if(key==='batch') return async statements=>{
    batches++;if(batches===2) throw new Error('synthetic_finalize_failure');return target.batch(statements);};
    const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const submission=await invokeNode(new Request(publicOrigin+'/submit',{method:'POST',headers:{Origin:studentOrigin,
    Authorization:`Bearer ${await studentToken()}`},body:form({title:'Interrupted private upload'})}),{DB:injectedDB});
  assert.equal(submission.status,502,await submission.clone().text());
  const interrupted=await db.prepare("SELECT * FROM submissions WHERE id<>?").bind(id).first();
  assert.equal(interrupted.status,'rejected');assert.equal(interrupted.contributor_email,null);
  assert.equal((await publicDownload(interrupted.id)).status,404);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM resources WHERE id=?').bind(interrupted.id).first()).n,0);
  assert.equal((await bucket.list()).objects.length,1,'only the original approved file survives');
});
