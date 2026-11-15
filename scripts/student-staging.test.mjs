import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {prepareStudentStaging, API_ORIGIN, STUDENT_ORIGIN} from './prepare-student-staging.mjs';
import {CONFIG} from '../site/js/config.mjs';
import {runInNewContext} from 'node:vm';

const fixtureSettings = {googleClientId:'123456789-synthetic-staging.apps.googleusercontent.com',
  turnstileSiteKey:'0x4SYNTHETIC_STAGING_WIDGET'};

test('isolated student build routes the real UI to staging and leaves production byte-for-byte unchanged', async () => {
  const root=fileURLToPath(new URL('../',import.meta.url));
  await mkdir(resolve(root,'dist'),{recursive:true});
  const temp=await mkdtemp(resolve(root,'dist/student-test-'));
  const before=await readFile(resolve(root,'site/js/config.mjs'));
  try {
    const output=resolve(temp,'site'), configOutput=resolve(temp,'configs');
    await prepareStudentStaging({...fixtureSettings,output,configOutput});
    const {CONFIG:staging}=await import(pathToFileURL(resolve(output,'js/config.mjs')));
    assert.equal(staging.privateModeration,true);
    assert.equal(staging.resourcesEndpoint,API_ORIGIN+'/resources');
    assert.equal(staging.submissionEndpoint,API_ORIGIN+'/submit');
    assert.deepEqual(await readFile(resolve(root,'site/js/config.mjs')),before);
    assert.equal(CONFIG.privateModeration,false);
    assert.deepEqual(JSON.parse(await readFile(resolve(output,'resources.json'))),[]);
    assert.match(await readFile(resolve(output,'index.html'),'utf8'),/Synthetic staging acceptance only/);
    const backend=JSON.parse(await readFile(resolve(configOutput,'moderation.json')));
    assert.equal(backend.vars.SUBMISSIONS_ENABLED,'false');
    assert.equal(backend.vars.CLEANUP_ENABLED,'false');
    assert.equal(backend.vars.ALLOWED_ORIGIN,STUDENT_ORIGIN);
    assert.equal('ADMIN_EMAILS' in backend.vars,false);
    assert.equal('STAGING_STUDENT_EMAILS' in backend.vars,false);
    assert.deepEqual(backend.secrets.required,['ADMIN_EMAILS','STAGING_STUDENT_EMAILS','TURNSTILE_SECRET']);
    assert.equal(backend.d1_databases[0].database_id,'f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6');
    assert.equal(backend.r2_buckets[0].bucket_name,'root-archive-private-staging');
    assert.deepEqual(backend.routes.map(x=>x.pattern),['admin.archive.rootamman.com','api-staging.rootamman.com']);
    const frontend=JSON.parse(await readFile(resolve(configOutput,'frontend.json')));
    assert.equal(frontend.name,'root-archive-student-staging');
    assert.equal(frontend.workers_dev,false);assert.equal(frontend.preview_urls,false);
    assert.deepEqual(frontend.routes.map(x=>x.pattern),[new URL(STUDENT_ORIGIN).hostname]);
    assert.equal(frontend.d1_databases,undefined);assert.equal(frontend.r2_buckets,undefined);
  } finally {await rm(temp,{recursive:true,force:true});}
});

test('build rejects missing or reused production OAuth/widget settings and unsafe output',async()=>{
  for(const settings of [{}, {...fixtureSettings,googleClientId:CONFIG.googleClientId},
    {...fixtureSettings,turnstileSiteKey:CONFIG.turnstileSiteKey},
    {...fixtureSettings,turnstileSiteKey:'1x00000000000000000000AA'},
    {...fixtureSettings,pausedSetup:true,enabled:true},
    {...fixtureSettings,output:fileURLToPath(new URL('../site',import.meta.url))}]) {
    await assert.rejects(prepareStudentStaging(settings));
  }
});

test('explicit paused setup accepts no Google client and produces only a paused, clearly marked deployment',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  await mkdir(resolve(root,'dist'),{recursive:true});
  const temp=await mkdtemp(resolve(root,'dist/student-paused-test-'));
  try {
    const output=resolve(temp,'site'),configOutput=resolve(temp,'configs');
    await prepareStudentStaging({turnstileSiteKey:fixtureSettings.turnstileSiteKey,pausedSetup:true,output,configOutput});
    const backend=JSON.parse(await readFile(resolve(configOutput,'moderation.json')));
    assert.equal(backend.vars.SUBMISSIONS_ENABLED,'false');assert.equal(backend.vars.GOOGLE_CLIENT_ID,'');
    assert.equal(JSON.parse(await readFile(resolve(configOutput,'manifest.json'))).setupPending,true);
    assert.match(await readFile(resolve(output,'index.html'),'utf8'),/Google sign-in is not configured; submissions remain paused/);
  } finally {await rm(temp,{recursive:true,force:true});}
});

test('owner denial helper is staging-only, idle until a UI submit, changes only the challenge once',async()=>{
  const source=await readFile(new URL('./staging-turnstile-denial.js',import.meta.url),'utf8');
  const calls=[];
  const original=async(input,options)=>{calls.push({input,options});return {status:403};};
  const sandbox={window:{fetch:original},location:{origin:STUDENT_ORIGIN,href:STUDENT_ORIGIN+'/'},URL,FormData};
  assert.throws(()=>runInNewContext(source,{...sandbox,location:{origin:'https://archive.rootamman.com'}}),/Staging/);
  runInNewContext(source,sandbox);
  assert.equal(calls.length,0);
  await sandbox.window.fetch(API_ORIGIN+'/resources');
  const form=new FormData();form.set('turnstile_token','synthetic-valid-fixture');form.set('title','Synthetic');
  const headers={Authorization:'synthetic-opaque-fixture'};
  await sandbox.window.fetch(API_ORIGIN+'/submit',{method:'POST',headers,body:form});
  assert.equal(calls[1].options.body.get('turnstile_token'),'synthetic-invalid-staging-acceptance');
  assert.equal(calls[1].options.body.get('title'),'Synthetic');
  assert.equal(calls[1].options.headers,headers);
  assert.equal(form.get('turnstile_token'),'synthetic-valid-fixture');
  assert.equal(sandbox.window.fetch,original);
});
