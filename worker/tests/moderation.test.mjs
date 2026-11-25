import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {Miniflare, convertV4MiniflareOptions, Response as MiniflareResponse} from 'miniflare';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {createHash} from 'node:crypto';
import {CONTRIBUTOR_AUTHORIZATION} from '../../site/js/contributor-authorization.mjs';
import {CONTRIBUTOR_PRIVACY_CONSENT} from '../../site/js/contributor-privacy-consent.mjs';

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
const [course, otherCourse] = JSON.parse(readFileSync(new URL('../../site/courses.json', import.meta.url)));
const {privateKey, publicKey} = await generateKeyPair('RS256');
const {privateKey: wrongKey} = await generateKeyPair('RS256');
const jwks = {keys:[{...await exportJWK(publicKey), kid:'moderation-fixture', alg:'RS256', use:'sig'}]};
const testWindowStart=Date.now()-60000;
const baseBindings = {
  ADMIN_ORIGIN:adminOrigin, PUBLIC_API_ORIGIN:publicOrigin, ALLOWED_ORIGIN:studentOrigin,
  ACCESS_ISSUER:issuer, ACCESS_AUD:'synthetic-admin-app', ADMIN_EMAILS:actor,
  GOOGLE_CLIENT_ID:'synthetic-google-app', TURNSTILE_SECRET:'synthetic-turnstile',
  STAGING_STUDENT_EMAILS:studentEmail,
  SUBMISSIONS_ENABLED:'true', CLEANUP_ENABLED:'true',
  STAGING_SUBMISSIONS_OPENS_AT:new Date(testWindowStart).toISOString(),
  STAGING_SUBMISSIONS_CLOSES_AT:new Date(testWindowStart+3600000).toISOString(),
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
    turnstile_token:'synthetic-challenge',declaration_accepted:'true',declaration_version:CONTRIBUTOR_AUTHORIZATION.version,
    privacy_consent_accepted:'true',privacy_consent_version:CONTRIBUTOR_PRIVACY_CONSENT.version,
    file:new File(['%PDF-original'], 'original.pdf',{type:'application/pdf'}),...patch})) {
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
  await db.prepare('CREATE TABLE d1_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)').run();
  await db.prepare('INSERT INTO d1_migrations VALUES (?,?)')
    .bind('0006_resource_download_analytics.sql','2026-11-25 09:15:00').run();
});
test.beforeEach(async () => {
  await db.batch(['DELETE FROM operator_imports','DELETE FROM contributor_authorizations','DELETE FROM moderation_audit','DELETE FROM resources','DELETE FROM file_revisions','DELETE FROM submissions'].map(sql=>db.prepare(sql)));
  await db.prepare('UPDATE cleanup_state SET cursor=NULL,version=1 WHERE singleton=1').run();
  const listed=await bucket.list();
  if(listed.objects.length) await bucket.delete(listed.objects.map(o=>o.key));
  turnstileSuccess=true;outbound=[];
});
test.after(async () => {await mf?.dispose();});

test('all admin API, static, file and alternate-host boundaries independently require Access and allowlist authorization',async () => {
  const paths=['/','/index.html','/styles.css','/js/admin.mjs','/js/image-editor.mjs',
    '/assets/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2','/admin/api/session',
    '/admin/api/courses','/admin/api/analytics','/admin/api/submissions','/admin/api/submissions/12345678-1234-4123-8123-123456789abc',
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

test('staging account allowlist gates verification and submission; pause prevents all D1/R2 writes',async () => {
  const jwt=await studentToken();
  const request=path=>new Request(publicOrigin+path,{method:'POST',headers:{Origin:studentOrigin,
    Authorization:`Bearer ${jwt}`},...(path==='/submit'?{body:form()}: {})});
  for(const allowlist of [undefined, '', 'other@std.aum.edu.jo']) {
    for(const path of ['/auth/verify','/submit']) {
      assert.equal((await invokeNode(request(path),{STAGING_STUDENT_EMAILS:allowlist})).status,allowlist ? 403 : 503);
    }
  }
  assert.equal((await invokeNode(request('/auth/verify'),{STAGING_STUDENT_EMAILS:` ${studentEmail.toUpperCase()} `})).status,200);
  assert.equal((await submit({},await studentToken({email:'other@std.aum.edu.jo'}))).status,403);
  assert.equal((await invokeNode(request('/submit'),{SUBMISSIONS_ENABLED:'false'})).status,503);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_revisions').first()).n,0);
  assert.equal((await bucket.list()).objects.length,0);
});

test('server cutoff fails closed independently of enabled flag and prevents upload intents',async()=>{
  const {stagingSubmissionWindowOpen}=await import('../.wrangler/moderation-dist/moderation.js');
  const opens=Date.now(),closes=opens+3600000;
  const window={SUBMISSIONS_ENABLED:'true',STAGING_SUBMISSIONS_OPENS_AT:new Date(opens).toISOString(),
    STAGING_SUBMISSIONS_CLOSES_AT:new Date(closes).toISOString()};
  assert.equal(stagingSubmissionWindowOpen(window,opens-1),false);
  assert.equal(stagingSubmissionWindowOpen(window,opens),true);
  assert.equal(stagingSubmissionWindowOpen(window,closes-1),true);
  assert.equal(stagingSubmissionWindowOpen(window,closes),false);
  assert.equal(stagingSubmissionWindowOpen(window,closes+1),false);
  assert.equal(stagingSubmissionWindowOpen({...window,SUBMISSIONS_ENABLED:'false'},opens),false);
  const jwt=await studentToken();
  for(const patch of [
    {STAGING_SUBMISSIONS_OPENS_AT:undefined}, {STAGING_SUBMISSIONS_CLOSES_AT:''},
    {STAGING_SUBMISSIONS_CLOSES_AT:'invalid'},
    {STAGING_SUBMISSIONS_OPENS_AT:new Date(opens-7200000).toISOString(),STAGING_SUBMISSIONS_CLOSES_AT:new Date(opens-3600000).toISOString()},
    {STAGING_SUBMISSIONS_OPENS_AT:new Date(opens+60000).toISOString(),STAGING_SUBMISSIONS_CLOSES_AT:new Date(opens+120000).toISOString()},
    {STAGING_SUBMISSIONS_OPENS_AT:new Date(opens-1000).toISOString(),STAGING_SUBMISSIONS_CLOSES_AT:new Date(opens+3600000).toISOString()},
  ]) {
    const response=await invokeNode(new Request(publicOrigin+'/submit',{method:'POST',headers:{Origin:studentOrigin,
      Authorization:`Bearer ${jwt}`},body:form()}),patch);
    assert.equal(response.status,503);
  }
  // Advance the request clock inside the mocked Siteverify response. This
  // proves a request admitted before cutoff cannot create an intent afterwards,
  // without sleeps, a running operator process, or any hosted fault injection.
  const originalNow=Date.now;let requestNow=originalNow();const cutoff=requestNow+60000;
  Date.now=()=>requestNow;
  try {
    const response=await invokeNode(new Request(publicOrigin+'/submit',{method:'POST',headers:{Origin:studentOrigin,
      Authorization:`Bearer ${jwt}`},body:form()}),{
      STAGING_SUBMISSIONS_OPENS_AT:new Date(requestNow).toISOString(),STAGING_SUBMISSIONS_CLOSES_AT:new Date(cutoff).toISOString(),
    },()=>{requestNow=cutoff;});
    assert.equal(response.status,503);
  } finally {Date.now=originalNow;}
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_revisions').first()).n,0);
  assert.equal((await bucket.list()).objects.length,0);
});

test('explicit production mode retains Google, origin, Turnstile, declaration and pause gates without staging-only limits',async()=>{
  const production = {CONTRIBUTOR_MODE:'production', STAGING_STUDENT_EMAILS:'',
    STAGING_SUBMISSIONS_OPENS_AT:'', STAGING_SUBMISSIONS_CLOSES_AT:''};
  const request = async (path='/submit', claims={}, origin=studentOrigin, patch={}) => new Request(publicOrigin+path,
    {method:'POST', headers:{Origin:origin, Authorization:`Bearer ${await studentToken(claims)}`},
      ...(path==='/submit' ? {body:form(patch)} : {})});
  assert.equal((await invokeNode(await request('/auth/verify',{email:'another@std.aum.edu.jo'}),production)).status,200);
  for (const claims of [{aud:'wrong'},{hd:'aum.edu.jo'},{email:'x@gmail.com'},{email_verified:false},
    {exp:Math.floor(Date.now()/1000)-60}]) {
    assert.ok([401,403].includes((await invokeNode(await request('/submit',claims),production)).status));
  }
  assert.equal((await invokeNode(await request('/submit',{},'https://attacker.invalid'),production)).status,403);
  assert.equal((await invokeNode(await request(),{...production,SUBMISSIONS_ENABLED:'false'})).status,503);
  assert.equal((await invokeNode(await request(),{...production,CONTRIBUTOR_MODE:'prod'})).status,503);
  turnstileSuccess=false;
  assert.equal((await invokeNode(await request(),production)).status,403);
  turnstileSuccess=true;
  assert.equal((await invokeNode(await request('/submit',{},studentOrigin,{declaration_accepted:undefined}),production)).status,400);
  assert.equal((await invokeNode(await request('/submit',{},studentOrigin,{privacy_consent_accepted:undefined}),production)).status,400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,0);
  assert.equal((await bucket.list()).objects.length,0);
  const accepted=await invokeNode(await request('/submit',{email:'another@std.aum.edu.jo'}),production);
  assert.equal(accepted.status,201,await accepted.clone().text());
  const {submission_id:id}=await accepted.json();
  assert.equal((await db.prepare('SELECT contributor_email FROM contributor_authorizations WHERE submission_id=?').bind(id).first()).contributor_email,'another@std.aum.edu.jo');
  assert.equal((await publicDownload(id)).status,404);
  assert.deepEqual((await publicCatalog()).resources,[]);
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

async function invokeNode(request, overrides={}, onSiteverify, ctx={waitUntil:()=>{}}) {
  const {default:worker}=await import('../.wrangler/moderation-dist/moderation.js');
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (input) => {
    const url=new URL(input instanceof Request?input.url:input);
    if(url.href===`${issuer}/cdn-cgi/access/certs` || url.href==='https://www.googleapis.com/oauth2/v3/certs') return Response.json(jwks);
    if(url.href==='https://challenges.cloudflare.com/turnstile/v0/siteverify') {onSiteverify?.();return Response.json({success:turnstileSuccess});}
    throw new Error('Unexpected Node fixture network request');
  };
  try {return await worker.fetch(request,{...baseBindings,DB:db,PRIVATE_FILES:bucket,...overrides},ctx);}
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

test('private submissions reject absent, false, stale or duplicate contributor acceptance before any writes',async () => {
  for (const patch of [{declaration_accepted:undefined},{declaration_accepted:'false'},
    {declaration_accepted:'on'},{declaration_version:undefined},{declaration_version:'old-version'},
    {privacy_consent_accepted:undefined},{privacy_consent_accepted:'false'},{privacy_consent_accepted:'on'},
    {privacy_consent_version:undefined},{privacy_consent_version:'old-version'},{privacy_consent_version:'1.0-2026-11-16'}]) {
    assert.equal((await submit(patch)).status,400);
  }
  for (const field of ['declaration_accepted','declaration_version','privacy_consent_accepted','privacy_consent_version']) {
    const body=form(); body.append(field,body.get(field));
    assert.equal((await dispatch(new Request(publicOrigin+'/submit',{method:'POST',
      headers:{Origin:studentOrigin,Authorization:`Bearer ${await studentToken()}`},body}))).status,400);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM submissions').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM contributor_authorizations').first()).n,0);
  assert.equal((await bucket.list()).objects.length,0);
});

test('authorization binds verified identity, exact wording, file hash, original revision and event, surviving replacement/removal privately',async () => {
  let record=await create({contributor:'Chosen pseudonym'}); const id=record.submission.id;
  const receipt=await db.prepare('SELECT * FROM contributor_authorizations WHERE submission_id=?').bind(id).first();
  const event=await db.prepare("SELECT * FROM moderation_audit WHERE submission_id=? AND action='submission_received'").bind(id).first();
  assert.deepEqual(receipt,{
    submission_id:id,original_revision_id:record.submission.original_revision_id,
    received_operation_id:event.operation_id,contributor_sub:'synthetic-identity',contributor_email:studentEmail,
    declaration_version:CONTRIBUTOR_AUTHORIZATION.version,declaration_language:'en',declaration_text:CONTRIBUTOR_AUTHORIZATION.text,
    acceptance_method:'affirmative_checkbox',public_credit:'Chosen pseudonym',
    file_sha256:createHash('sha256').update('%PDF-original').digest('hex'),accepted_at:event.created_at,
    privacy_consent_version:CONTRIBUTOR_PRIVACY_CONSENT.version,privacy_consent_text:CONTRIBUTOR_PRIVACY_CONSENT.text,
  });
  assert.deepEqual(record.authorization,receipt);
  await assert.rejects(db.prepare("UPDATE contributor_authorizations SET declaration_version='changed' WHERE submission_id=?").bind(id).run(),/immutable/);
  record=await read(await replacement(record));
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  const catalog=JSON.stringify(await publicCatalog());
  assert.match(catalog,/Chosen pseudonym/);
  assert.ok(!catalog.includes(studentEmail) && !catalog.includes('synthetic-identity') && !catalog.includes('declaration_') && !catalog.includes('privacy_consent'));
  record=await read(await action(record,'remove',{reason:'Contributor withdrawal'}));
  assert.equal(record.submission.contributor_email,null);
  assert.deepEqual(await db.prepare('SELECT * FROM contributor_authorizations WHERE submission_id=?').bind(id).first(),receipt);
  assert.equal((await publicDownload(id)).status,404);
  assert.equal((await bucket.list()).objects.length,0);
});

test('failure to persist authorization rolls back submission receipt and ready revision atomically',async () => {
  await db.prepare("CREATE TRIGGER fixture_fail_authorization BEFORE INSERT ON contributor_authorizations BEGIN SELECT RAISE(ABORT, 'synthetic_receipt_failure'); END").run();
  try {
    assert.equal((await submit()).status,502);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM contributor_authorizations').first()).n,0);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM moderation_audit WHERE action='submission_received'").first()).n,0);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM file_revisions WHERE status='ready'").first()).n,0);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM submissions WHERE status='pending'").first()).n,0);
    assert.equal((await bucket.list()).objects.length,0);
  } finally {await db.prepare('DROP TRIGGER fixture_fail_authorization').run();}
});


test('historical and pre-privacy receipts keep their exact evidence across new consent and removal', async () => {
  const original = JSON.parse(readFileSync(new URL('./fixtures/privacy-consent-v1.json', import.meta.url), 'utf8'));
  for (const historical of [original, {version:null,text:null}]) {
    let record = await create();
    const id = record.submission.id;
    const receipt = {...record.authorization, privacy_consent_version:historical.version, privacy_consent_text:historical.text};
    // Seed a synthetic historical receipt in local D1; production records are never touched.
    await db.prepare('DELETE FROM contributor_authorizations WHERE submission_id=?').bind(id).run();
    const keys = Object.keys(receipt);
    await db.prepare(`INSERT INTO contributor_authorizations (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...Object.values(receipt)).run();
    await create();
    assert.deepEqual((await read(await admin(`/admin/api/submissions/${id}`))).authorization, receipt);
    await assert.rejects(db.prepare('UPDATE contributor_authorizations SET privacy_consent_version=? WHERE submission_id=?').bind(CONTRIBUTOR_PRIVACY_CONSENT.version,id).run(), /immutable/);
    record = await read(await action(record,'remove',{reason:'Synthetic historical withdrawal'}));
    assert.deepEqual((await read(await admin(`/admin/api/submissions/${id}`))).authorization, receipt);
  }
});

const importForm=(patch={})=>{
  const body=new FormData();
  for(const [key,value] of Object.entries({operation_id:crypto.randomUUID(),file_sha256:createHash('sha256').update('%PDF-operator-fixture').digest('hex'),
    course_id:course.id,type:'Notes',title:'Operator fixture notes',academic_term:JSON.stringify({academic_year:'2024-2025',semester:'Fall'}),
    permission_attested:'true',attestation_version:'operator-permission-v1',file:new File(['%PDF-operator-fixture'],'operator.pdf',{type:'application/pdf'}),...patch})) {
    if(value!==undefined)body.set(key,value);
  }
  return body;
};
const importPost=body=>admin('/admin/api/import',{method:'POST',body});
async function acceptedImport(patch={}) {
  const body=importForm(patch),response=await importPost(body);
  assert.equal(response.status,201,await response.clone().text());
  return {body,receipt:await response.json()};
}
async function importNode(body,overrides={}) {
  return invokeNode(new Request(`${adminOrigin}/admin/api/import`,{method:'POST',body,
    headers:{Origin:adminOrigin,'X-Requested-With':'root-admin','Cf-Access-Jwt-Assertion':await adminToken()}}),overrides);
}

test('operator import rejects anonymous/student/invalid JWT, alternate hosts and browser origin violations before writes',async()=>{
  for(const jwt of [undefined,await studentToken(),await adminToken({},wrongKey),await adminToken({exp:Math.floor(Date.now()/1000)-60}),await adminToken({email:studentEmail})]) {
    const response=await dispatch(new Request(`${adminOrigin}/admin/api/import`,{method:'POST',body:importForm(),headers:{Origin:adminOrigin,'X-Requested-With':'root-admin',...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{})}}));
    assert.ok([401,403].includes(response.status));
  }
  for(const host of [publicOrigin,'https://alternate.workers.dev']) assert.equal((await dispatch(new Request(host+'/admin/api/import',{method:'POST',body:importForm(),headers:{'Cf-Access-Jwt-Assertion':await adminToken()}}))).status,404);
  for(const headers of [{},{Origin:'https://evil.invalid','X-Requested-With':'root-admin'},{Origin:adminOrigin,'X-Requested-With':'root-admin','Sec-Fetch-Site':'cross-site'}]) {
    assert.equal((await dispatch(new Request(`${adminOrigin}/admin/api/import`,{method:'POST',body:importForm(),headers:{'Cf-Access-Jwt-Assertion':await adminToken(),...headers}}))).status,403);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,0);assert.equal((await bucket.list()).objects.length,0);
});
test('operator input strictly validates attestation, metadata, hash, file types, bounds and repeated/private identity fields',async()=>{
  for(const patch of [{permission_attested:'false'},{permission_attested:undefined},{attestation_version:'invented'},
    {course_id:'9999999'},{type:'Past Paper'},{title:'<script>bad</script>'},{file_sha256:'a'.repeat(64)},
    {academic_term:'{"academic_year":"2024-2026","semester":"Fall"}'},{academic_term:'{"academic_year":null,"semester":"Winter"}'},
    {file:new File(['%PDF-fake'],'fake.exe',{type:'application/pdf'})},{file:new File(['bad'],'bad.pdf',{type:'application/pdf'})},
    {contributor:'Invented'},{contributor_email:actor},{declaration_accepted:'true'}]) {
    const response=await importPost(importForm(patch));assert.equal(response.status,400,await response.clone().text());
  }
  const repeated=importForm();repeated.append('course_id',course.id);assert.equal((await importPost(repeated)).status,400);
  const huge=importForm({file:new File(['%PDF-',new Uint8Array(24*1024*1024)],'huge.pdf',{type:'application/pdf'})});
  assert.equal((await importNode(huge)).status,400);
  const body=importForm();body.set('academic_term',JSON.stringify({academic_year:null,semester:null}));
  const result=await importPost(body);assert.equal(result.status,201,await result.clone().text());
  assert.equal((await db.prepare('SELECT semester FROM submissions').first()).semester,'');
});
test('valid administrator import stays private/pending with truthful provenance and no student authorization or external calls',async()=>{
  const {body,receipt}=await acceptedImport();
  const record=await read(await admin(`/admin/api/submissions/${receipt.submission_id}`));
  assert.equal(record.submission.status,'pending');assert.equal(record.submission.contributor,null);assert.equal(record.submission.contributor_sub,null);assert.equal(record.submission.contributor_email,null);
  assert.equal(record.submission.semester,'Fall 2024-2025');assert.equal(record.authorization,null);assert.equal(record.operator_import.operator_email,actor);
  assert.equal(record.operator_import.file_sha256,body.get('file_sha256'));assert.equal(record.operator_import.operation_id,body.get('operation_id'));
  assert.match(record.operator_import.attestation_text,/not claiming authorship/);assert.equal(record.audit[0].actor,actor);
  assert.equal(record.revisions[0].status,'ready');assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM resources').first()).n,0);
  assert.equal((await publicDownload(receipt.submission_id)).status,404);assert.deepEqual((await publicCatalog()).resources,[]);
  assert.ok(outbound.every(url=>url===`${issuer}/cdn-cgi/access/certs`),'imports never call Google, Turnstile, GitHub or an AI service');
  assert.equal((await read(await admin('/admin/api/submissions'))).submissions.length,1);
  // Imports work while student submissions are paused, without changing that flag.
  const different=importForm({file:new File(['%PDF-paused-fixture'],'paused.pdf',{type:'application/pdf'}),file_sha256:createHash('sha256').update('%PDF-paused-fixture').digest('hex')});
  assert.equal((await importNode(different,{SUBMISSIONS_ENABLED:'false',TURNSTILE_SECRET:''})).status,201);
});
test('durable same-operation receipts survive response loss, moderation changes and removal; duplicate content never reserves another submission',async()=>{
  const {body,receipt}=await acceptedImport();
  assert.deepEqual(await read(await importPost(body)),receipt);
  const changed=importForm(Object.fromEntries(body));changed.set('title','Changed payload');
  const conflict=await importPost(changed);assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'operation_conflict');
  const duplicate=await importPost(importForm());assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).code,'duplicate_content');
  const preflight=await admin(`/admin/api/import/${crypto.randomUUID()}?file_sha256=${body.get('file_sha256')}`);assert.equal(preflight.status,409);
  let record=await read(await admin(`/admin/api/submissions/${receipt.submission_id}`));
  record=await read(await action(record,'remove',{reason:'Synthetic removal'}));assert.equal(record.submission.status,'removed');
  const replay=await read(await importPost(body));assert.equal(replay.submission_id,receipt.submission_id);assert.equal(replay.moderation_status,'removed');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,1);assert.equal((await bucket.list()).objects.length,0);
  assert.equal((await importPost(importForm())).status,409);
  const lookup=await read(await admin(`/admin/api/import/${body.get('operation_id')}`));assert.equal(lookup.accepted_at,receipt.accepted_at);
});
test('concurrent same-operation and same-content imports reserve one submission and one ready revision',async()=>{
  const body=importForm();
  const results=await Promise.all([importPost(body),importPost(body),importPost(importForm())]);
  assert.equal(results.filter(r=>r.status===201).length,1);
  assert.ok(results.every(r=>[200,201,409].includes(r.status)));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM file_revisions WHERE status='ready'").first()).n,1);
  assert.equal((await bucket.list()).objects.length,1);
});
test('operator imports use all existing moderation actions and enforce no public credit at metadata and D1 boundaries',async()=>{
  const {receipt}=await acceptedImport();let record=await read(await admin(`/admin/api/submissions/${receipt.submission_id}`));
  assert.equal((await action(record,'metadata',{...record.submission,contributor:'Operator'})).status,400);
  await assert.rejects(db.prepare('UPDATE submissions SET contributor=? WHERE id=?').bind('Operator',receipt.submission_id).run(),/credit|identity/);
  record=await read(await action(record,'review'));
  record=await read(await action(record,'metadata',{...record.submission,title:'Reviewed fixture',contributor:null}));
  record=await read(await replacement(record,'%PDF-cleaned-operator'));
  record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  assert.equal(record.published.contributor,null);assert.equal(await (await publicDownload(receipt.submission_id)).text(),'%PDF-cleaned-operator');
  record=await read(await action(record,'unpublish',{reason:'Synthetic review'}));assert.equal((await publicDownload(receipt.submission_id)).status,404);
  record=await read(await action(record,'review'));record=await read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
  record=await read(await action(record,'remove',{reason:'Synthetic cleanup'}));await cleanup();assert.equal((await bucket.list()).objects.length,0);
  assert.equal(record.authorization,null);assert.equal(record.operator_import.operation_id,receipt.operation_id);
});
test('known student original content is flagged as duplicate without changing genuine contributor evidence',async()=>{
  const student=await create();const authorization=student.authorization;
  const response=await importPost(importForm({file:new File(['%PDF-original'],'student.pdf',{type:'application/pdf'}),file_sha256:createHash('sha256').update('%PDF-original').digest('hex')}));
  assert.equal(response.status,409);assert.equal((await response.json()).code,'duplicate_content');
  assert.deepEqual((await read(await admin(`/admin/api/submissions/${student.submission.id}`))).authorization,authorization);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM operator_imports').first()).n,0);
});
test('failed R2 imports clean up durably and retry the same operation/submission with a fresh immutable revision',async()=>{
  const body=importForm();const failing=new Proxy(bucket,{get(target,key){if(key==='put')return async()=>{throw new Error('synthetic_put_failure');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const response=await importNode(body,{PRIVATE_FILES:failing});assert.equal(response.status,502,await response.clone().text());
  const before=await db.prepare('SELECT * FROM operator_imports').first();assert.equal(before.accepted_at,null);
  assert.equal((await db.prepare('SELECT status FROM file_revisions').first()).status,'deleted');
  const retry=await importPost(body);assert.equal(retry.status,201,await retry.clone().text());const receipt=await retry.json();assert.equal(receipt.submission_id,before.submission_id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_revisions').first()).n,2);
});
test('post-PUT D1 rollback, cleanup failure and committed-but-unacknowledged finalize are safe to retry',async()=>{
  const body=importForm();
  await db.prepare("CREATE TRIGGER fixture_fail_import BEFORE UPDATE OF accepted_at ON operator_imports WHEN NEW.accepted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic_receipt_failure'); END").run();
  try {
    const failed=await importNode(body);assert.equal(failed.status,502,await failed.clone().text());
    assert.equal((await db.prepare('SELECT accepted_at FROM operator_imports').first()).accepted_at,null);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM moderation_audit').first()).n,0);
    assert.equal((await bucket.list()).objects.length,0);
  } finally {await db.prepare('DROP TRIGGER fixture_fail_import').run();}
  let committed=false;
  const ambiguousDB=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{
    const result=await target.batch(statements);
    if(!committed && (await db.prepare('SELECT accepted_at FROM operator_imports').first())?.accepted_at){committed=true;throw new Error('lost commit acknowledgement');}
    return result;
  };const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const retried=await importNode(body,{DB:ambiguousDB});assert.equal(retried.status,200,await retried.clone().text());
  const receipt=await retried.json();assert.ok(receipt.accepted_at);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM file_revisions WHERE status='ready'").first()).n,1);
});
test('unconfirmed in-flight import blocks replay until deadline cleanup and never revives a late prior revision',async()=>{
  const body=importForm();let release,started;
  const waitStarted=new Promise(resolve=>{started=resolve;});const waitRelease=new Promise(resolve=>{release=resolve;});
  const delayed=new Proxy(bucket,{get(target,key){if(key==='put')return async(...args)=>{started();await waitRelease;return target.put(...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const first=importNode(body,{PRIVATE_FILES:delayed});await waitStarted;
  const blocked=await importPost(body);assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'import_in_progress');
  await db.prepare("UPDATE submissions SET created_at='2020-01-01T00:00:00.000Z'").run();
  await db.prepare("UPDATE file_revisions SET upload_deadline='2020-01-01T00:00:00.000Z'").run();await cleanup();
  const retried=await importPost(body);assert.equal(retried.status,201,await retried.clone().text());
  release();const late=await first;assert.ok([200,502].includes(late.status));await cleanup();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM file_revisions WHERE status='ready'").first()).n,1);
  assert.equal((await bucket.list()).objects.length,1);assert.equal((await publicCatalog()).resources.length,0);
});

test('initial D1 reservation failure never writes R2; failed deletion blocks retry until cleanup succeeds',async()=>{
  const body=importForm();
  const failIntent=new Proxy(db,{get(target,key){if(key==='batch')return async()=>{throw new Error('synthetic_intent_failure');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  assert.equal((await importNode(body,{DB:failIntent})).status,503);
  assert.equal((await bucket.list()).objects.length,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,0);
  const failStorage=new Proxy(bucket,{get(target,key){if(['put','delete'].includes(key))return async()=>{throw new Error('synthetic_storage_failure');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  assert.equal((await importNode(body,{PRIVATE_FILES:failStorage})).status,502);
  const revision=await db.prepare('SELECT * FROM file_revisions').first();assert.equal(revision.status,'delete_pending');assert.equal(revision.last_delete_error,'storage_delete_failed');
  const blocked=await importPost(body);assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'cleanup_pending');
  await db.prepare("UPDATE file_revisions SET delete_after='2020-01-01T00:00:00.000Z'").run();await cleanup();
  const response=await importPost(body);assert.equal(response.status,201,await response.clone().text());
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,1);
});

test('fresh operator retry retains its new upload window even when the original reservation is old',async()=>{
  const body=importForm();
  const failStorage=new Proxy(bucket,{get(target,key){if(key==='put')return async()=>{throw new Error('synthetic_failure');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  assert.equal((await importNode(body,{PRIVATE_FILES:failStorage})).status,502);
  await db.prepare("UPDATE submissions SET created_at='2020-01-01T00:00:00.000Z'").run();
  let release,started;const waitStarted=new Promise(resolve=>{started=resolve;});const waitRelease=new Promise(resolve=>{release=resolve;});
  const delayed=new Proxy(bucket,{get(target,key){if(key==='put')return async(...args)=>{started();await waitRelease;return target.put(...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  const retry=importNode(body,{PRIVATE_FILES:delayed});await waitStarted;
  try {await cleanup();assert.equal((await db.prepare('SELECT status FROM submissions').first()).status,'receiving');}finally{release();}
  const response=await retry;assert.equal(response.status,201,await response.clone().text());
});

test('local CLI and protected Worker cooperate through synthetic Access forwarding and recover a lost POST response',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {scanDirectory}=await import('../../scripts/bulk-import-manifest.mjs');const {uploadManifest}=await import('../../scripts/bulk-import.mjs');
  const directory=await mkdtemp(join(tmpdir(),'operator-worker-integration-'));
  try {
    await writeFile(join(directory,'synthetic.pdf'),'%PDF-cli-worker-integration');
    const manifest=await scanDirectory(directory),entry=manifest.entries[0];
    Object.assign(entry,{course_id:course.id,title:'CLI integration fixture',type:'Notes',review_status:'ready',permission_attested:true});
    let posts=0;
    const fetcher=async(url,options)=>{
      assert.equal(options.headers['Cf-Access-Token'],'synthetic-application-token');
      // Emulate only Access's validated-token-to-assertion forwarding. No network
      // reaches Access or production; the Worker still verifies the signed JWT.
      const headers=new Headers(options.headers);headers.set('Cf-Access-Jwt-Assertion',await adminToken());
      const response=await dispatch(new Request(url,{...options,headers}));
      if(options.method==='POST'){posts++;assert.equal(response.status,201,await response.clone().text());throw new Error('synthetic lost response');}
      return response;
    };
    const options={origin:adminOrigin,token:'synthetic-application-token',execute:true,attest:true,fetcher};
    await uploadManifest(manifest,options);assert.equal(entry.import_status,'unknown');
    await uploadManifest(manifest,options);assert.equal(entry.import_status,'imported');assert.equal(posts,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM submissions').first()).n,1);
    assert.equal((await publicDownload(entry.receipt.submission_id)).status,404);
  } finally {await rm(directory,{recursive:true,force:true});}
});

const readAnalytics = async () => read(await admin('/admin/api/analytics'));
const downloadCount = async id => (await db.prepare('SELECT download_count FROM resources WHERE id=?').bind(id).first()).download_count;
const catalogGeneration = async () => (await db.prepare('SELECT generation FROM catalog_state WHERE singleton=1').first()).generation;
const approveResource = async record => read(await action(record,'approve',{revision_id:record.submission.candidate_revision_id}));
async function expectDownloadCount(id, expected) {
  const deadline = Date.now()+3000;
  while (Date.now() < deadline) {
    if (await downloadCount(id) === expected) return;
    await new Promise(resolve => setTimeout(resolve,15));
  }
  assert.equal(await downloadCount(id),expected);
}

test('public GET counts once per response, including concurrent direct links, without changing catalog or publication metadata',async()=>{
  const record=await approveResource(await create());
  const id=record.submission.id;
  const generation=await catalogGeneration();
  const before=await db.prepare('SELECT published_at,updated_at FROM resources WHERE id=?').bind(id).first();
  assert.equal(await downloadCount(id),0);

  const response=await publicDownload(id);
  assert.equal(response.status,200);
  assert.equal(await response.text(),'%PDF-original');
  await expectDownloadCount(id,1);

  const downloads=await Promise.all(Array.from({length:12},()=>publicDownload(id)));
  await Promise.all(downloads.map(async result=>{
    assert.equal(result.status,200);
    assert.equal(await result.text(),'%PDF-original');
  }));
  await expectDownloadCount(id,13);
  assert.equal(await catalogGeneration(),generation);
  assert.deepEqual(await db.prepare('SELECT published_at,updated_at FROM resources WHERE id=?').bind(id).first(),before);
  assert.ok(!Object.hasOwn((await publicCatalog()).resources[0],'download_count'));
});

test('HEAD, administrative previews, missing files, bad integrity and unavailable resources do not schedule increments',async()=>{
  let record=await approveResource(await create());
  const id=record.submission.id, revision=record.submission.candidate_revision_id;
  const waits=[];
  const inspect=(target=id,method='GET')=>invokeNode(new Request(publicOrigin+'/download/'+target,{method}),{},undefined,{
    waitUntil:task=>waits.push(task),
  });
  assert.equal((await inspect(id,'HEAD')).status,200);
  const preview=await admin(`/admin/api/submissions/${id}/files/${revision}`);
  assert.equal(preview.status,200);
  await preview.arrayBuffer();
  assert.equal((await inspect(crypto.randomUUID())).status,404);

  const revisionRow=await db.prepare('SELECT object_key FROM file_revisions WHERE id=?').bind(revision).first();
  await bucket.put(revisionRow.object_key,'%PDF-wrong-size-and-etag');
  assert.equal((await inspect()).status,404);
  await bucket.delete(revisionRow.object_key);
  assert.equal((await inspect()).status,404);
  record=await read(await action(record,'unpublish',{reason:'Fixture withdrawal'}));
  assert.equal((await inspect()).status,404);
  assert.equal(waits.length,0);
  assert.equal(await downloadCount(id),0);
});

test('analytics write failure leaves the successful public download response available',async()=>{
  const record=await approveResource(await create());
  const id=record.submission.id;
  await db.prepare("CREATE TRIGGER test_download_failure BEFORE UPDATE OF download_count ON resources BEGIN SELECT RAISE(ABORT, 'synthetic analytics failure'); END").run();
  try {
    const waits=[];
    const response=await invokeNode(new Request(publicOrigin+'/download/'+id),{},undefined,{waitUntil:task=>waits.push(task)});
    assert.equal(response.status,200);
    assert.equal(await response.text(),'%PDF-original');
    assert.equal(waits.length,1);
    await Promise.all(waits);
    assert.equal(await downloadCount(id),0);
  } finally {await db.prepare('DROP TRIGGER test_download_failure').run();}
});

test('counts survive edits, replacement, unpublication, republication and permanent removal',async()=>{
  let record=await approveResource(await create());
  const id=record.submission.id;
  assert.equal((await (await publicDownload(id)).text()),'%PDF-original');
  await expectDownloadCount(id,1);
  record=await read(await action(record,'metadata',{...record.submission,title:'Updated counting fixture'}));
  assert.equal(await downloadCount(id),1);
  record=await read(await replacement(record,'%PDF-replacement'));
  record=await approveResource(record);
  assert.equal(await downloadCount(id),1);
  assert.equal((await (await publicDownload(id)).text()),'%PDF-replacement');
  await expectDownloadCount(id,2);
  record=await read(await action(record,'unpublish',{reason:'Fixture re-review'}));
  assert.equal(await downloadCount(id),2);
  assert.equal((await publicDownload(id)).status,404);
  record=await approveResource(record);
  assert.equal(await downloadCount(id),2);
  record=await read(await action(record,'remove',{reason:'Fixture cleanup'}));
  assert.equal(record.published.title,'Removed material');
  assert.equal(await downloadCount(id),2);
  assert.equal((await publicDownload(id)).status,404);
});

test('protected analytics reports historical and current aggregates, zero state and deterministic top results',async()=>{
  const empty=await readAnalytics();
  assert.equal(empty.counter_baseline_at,'2026-11-25T09:15:00.000Z');
  assert.deepEqual(empty.overview,{total_downloads:0,published_resources:0,downloaded_published_resources:0,top_course:null,top_resource:null});
  assert.deepEqual(empty.resources,[]);
  const published=await approveResource(await create({title:'Published fixture'}));
  const withdrawn=await approveResource(await create({title:'Withdrawn fixture'}));
  const zero=await approveResource(await create({title:'Zero fixture',course_id:otherCourse.id}));
  await Promise.all([[published,3],[withdrawn,5]].map(async ([record,count])=>{
    const id=record.submission.id;
    for(let i=0;i<count;i++) assert.equal(await (await publicDownload(id)).text(),'%PDF-original');
    await expectDownloadCount(id,count);
  }));
  await read(await action(withdrawn,'unpublish',{reason:'Fixture withdrawal'}));
  const response=await admin('/admin/api/analytics');
  assert.match(response.headers.get('Cache-Control'),/no-store/);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  const result=await read(response);
  assert.equal(result.overview.total_downloads,8);
  assert.equal(result.overview.published_resources,2);
  assert.equal(result.overview.downloaded_published_resources,1);
  assert.equal(result.overview.top_course.course_id,course.id);
  assert.equal(result.overview.top_resource.id,withdrawn.submission.id);
  assert.deepEqual(result.resources.map(row=>[row.id,row.download_count,row.status]),[
    [withdrawn.submission.id,5,'unpublished'],[published.submission.id,3,'published'],[zero.submission.id,0,'published'],
  ]);
  assert.deepEqual(result.courses,[
    {course_id:course.id,download_count:8,published_download_count:3},
    {course_id:otherCourse.id,download_count:0,published_download_count:0},
  ]);
  for(const jwt of [await studentToken(),await adminToken({email:studentEmail}),await adminToken({},wrongKey)]) {
    assert.ok([401,403].includes((await admin('/admin/api/analytics',{jwt})).status));
  }
});
