import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareProduction, assertProductionPolicies, MIGRATIONS} from './prepare-production.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const settings = {databaseId:'11111111-1111-4111-8111-111111111111', accessAud:'1'.repeat(64),
  googleClientId:'123456789-production-fixture.apps.googleusercontent.com', turnstileSiteKey:'0x4SYNTHETIC_PRODUCTION_WIDGET',
  privacyNoticeApproved:false, contributorDeclarationApproved:false};

test('production preparation isolates bindings, emits paused phases and pins all three migration hashes', async()=>{
  const protectedFiles=['worker/wrangler.moderation.jsonc','worker/wrangler.student-staging.jsonc','site/js/config.mjs'];
  const before=await Promise.all(protectedFiles.map(p=>readFile(resolve(root,p))));
  const parent=resolve(root,'worker/.wrangler');await mkdir(parent,{recursive:true});
  const configOutput=await mkdtemp(resolve(parent,'production-test-'));
  try {
    const result=await prepareProduction(settings,{configOutput});
    assert.equal(result.pagesOutput,null);assert.equal(result.submissionsEnabled,false);
    assert.deepEqual(result.migrations.map(m=>m.name),MIGRATIONS);
    assert.ok(result.migrations.every(m=>/^[0-9a-f]{64}$/.test(m.sha256)));
    for(const [file,hosts] of [['moderation-unrouted.json',[]],['moderation-admin.json',['moderation.rootamman.com']],
      ['moderation-cutover.json',['moderation.rootamman.com','api.rootamman.com']]]) {
      const config=JSON.parse(await readFile(resolve(configOutput,file)));
      assert.deepEqual(config.routes.map(r=>r.pattern),hosts);
      assert.equal(config.vars.SUBMISSIONS_ENABLED,'false');assert.equal(config.vars.CONTRIBUTOR_MODE,'production');
      assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);assert.equal(config.assets.run_worker_first,true);
      assert.equal(config.d1_databases[0].database_id,settings.databaseId);
      assert.equal(config.r2_buckets[0].bucket_name,'root-archive-private-production');
      assert.deepEqual(config.triggers.crons,['*/5 * * * *']);
      assert.deepEqual(config.secrets.required,['ADMIN_EMAILS','TURNSTILE_SECRET']);
      assert.equal('ADMIN_EMAILS' in config.vars,false);
      assert.ok(!JSON.stringify(config).includes('GITHUB_TOKEN'));
    }
    const legacy=JSON.parse(await readFile(resolve(configOutput,'legacy-paused.json')));
    assert.equal(legacy.vars.LEGACY_SUBMISSIONS_ENABLED,'false');
    assert.equal(legacy.workers_dev,false);assert.equal(legacy.preview_urls,false);
    assert.deepEqual(legacy.triggers.crons,[]);
    for(let i=0;i<protectedFiles.length;i++) assert.deepEqual(await readFile(resolve(root,protectedFiles[i])),before[i]);
  } finally {await rm(configOutput,{recursive:true,force:true});}
});

test('production preparation rejects staging identity/resources and cannot publish blocked policy drafts',async()=>{
  for(const patch of [{databaseId:''},{databaseId:'f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6'},
    {accessAud:'0003d8d8ba905005bfed05fc441631de07c91985c3e2baab528bdb4bbb7ac5be'},
    {googleClientId:'451085424306-3akhui9717r3s41v1qeqgkn3rhehsk3i.apps.googleusercontent.com'},
    {turnstileSiteKey:'0x4AAAAAAGCJAasfjeVYO_Ia'}]) await assert.rejects(prepareProduction({...settings,...patch}));
  await assert.rejects(prepareProduction(settings,{configOutput:root}),/ignored/);
  await assert.rejects(prepareProduction(settings,{pages:true}),/publication blocked/);
  await assert.rejects(assertProductionPolicies({...settings,privacyNoticeApproved:true,contributorDeclarationApproved:true}),/unresolved review wording/);
});
