// Local artifacts only: no network, deployment, migration, or enablement command.
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONFIG} from '../site/js/config.mjs';
import {buildPolicies} from './build-policies.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const jsonc = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
const stagingDB = 'f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6';
const stagingAUD = '0003d8d8ba905005bfed05fc441631de07c91985c3e2baab528bdb4bbb7ac5be';
export const MIGRATIONS = [
  '0001_private_moderation.sql', '0002_catalog_generation.sql',
  '0003_contributor_authorizations.sql', '0004_contributor_privacy_consent.sql',
  '0005_operator_imports.sql', '0006_resource_download_analytics.sql',
];

export async function assertProductionPolicies(settings) {
  if (settings.privacyNoticeApproved !== true || settings.contributorDeclarationApproved !== true) {
    throw new Error('Production Pages publication blocked: Privacy Notice and Contributor Declaration approvals are required.');
  }
  for (const slug of ['privacy-notice', 'contributor-declaration']) {
    const source = await readFile(resolve(root, `docs/legal/root-archive-${slug}.md`), 'utf8');
    if (/\*\*BLOCKED|review draft|\[[^\]\n]*(?:confirm|insert|specify|to be)[^\]\n]*\]/i.test(source)) {
      throw new Error(`Production Pages publication blocked: ${slug} still contains unresolved review wording.`);
    }
  }
  await buildPolicies({check:true});
}

export async function prepareProduction(settings, {pages = false,
  output = resolve(root, 'dist/production'), configOutput = resolve(root, 'worker/.wrangler/production')} = {}) {
  const {databaseId, accessAud, googleClientId, turnstileSiteKey} = settings;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(databaseId || '') || databaseId === stagingDB) {
    throw new Error('Supply the separately created production D1 UUID; staging is forbidden.');
  }
  if (!/^[0-9a-f]{64}$/.test(accessAud || '') || accessAud === stagingAUD) {
    throw new Error('Supply the distinct production Access application audience.');
  }
  if (!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(googleClientId || '')
    || googleClientId === '451085424306-3akhui9717r3s41v1qeqgkn3rhehsk3i.apps.googleusercontent.com') {
    throw new Error('Supply a production Google Web client, never the staging client.');
  }
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(turnstileSiteKey || '')
    || turnstileSiteKey === '0x4AAAAAAGCJAasfjeVYO_Ia' || /^.[xX]00000000000000000000/.test(turnstileSiteKey)) {
    throw new Error('Supply a real production Turnstile widget key, never a staging/test key.');
  }
  if (!resolve(output).startsWith(resolve(root, 'dist') + '/')
    || !resolve(configOutput).startsWith(resolve(root, 'worker/.wrangler') + '/')) {
    throw new Error('Outputs must be inside ignored dist/ and worker/.wrangler/ directories.');
  }
  const names = (await readdir(resolve(root, 'worker/migrations'))).filter(n => n.endsWith('.sql')).sort();
  if (JSON.stringify(names) !== JSON.stringify(MIGRATIONS)) throw new Error('Migration set changed; reconcile the production sequence first.');
  if (pages) {
    await assertProductionPolicies(settings);
    const resources = JSON.parse(await readFile(resolve(root, 'site/resources.json'), 'utf8'));
    if (!Array.isArray(resources) || resources.length) throw new Error('Nonempty legacy catalog needs an explicit private import plan.');
  }
  const backend = await jsonc(resolve(root, 'worker/wrangler.production.jsonc'));
  backend.main = resolve(root, 'worker/moderation.ts');
  backend.assets.directory = resolve(root, 'admin');
  backend.d1_databases[0].database_id = databaseId;
  backend.d1_databases[0].migrations_dir = resolve(root, 'worker/migrations');
  backend.vars.ACCESS_AUD = accessAud;
  backend.vars.GOOGLE_CLIENT_ID = googleClientId;
  // Never copy production secret values from staging or the legacy Worker.
  const adminRoute = {pattern:'moderation.rootamman.com', custom_domain:true, zone_id:'fc80d6a45a703d0fe4d1876f1380870f'};
  const publicRoute = {...adminRoute, pattern:'api.rootamman.com'};
  await mkdir(configOutput, {recursive:true});
  for (const [filename, routes] of [['moderation-unrouted.json', []], ['moderation-admin.json', [adminRoute]],
    ['moderation-cutover.json', [adminRoute, publicRoute]]]) {
    await writeFile(resolve(configOutput, filename), JSON.stringify({...backend, routes}, null, 2) + '\n');
  }
  const legacy = await jsonc(resolve(root, 'worker/wrangler.jsonc'));
  legacy.main = resolve(root, 'worker/worker.ts');
  legacy.vars.LEGACY_SUBMISSIONS_ENABLED = 'false';
  legacy.vars.CLEANUP_MODE = 'off';
  legacy.workers_dev = false; legacy.preview_urls = false;
  legacy.triggers = {crons:[]};
  await writeFile(resolve(configOutput, 'legacy-paused.json'), JSON.stringify(legacy, null, 2) + '\n');
  if (pages) {
    await rm(output, {recursive:true, force:true});
    await cp(resolve(root, 'site'), output, {recursive:true});
    const source = await readFile(resolve(root, 'site/js/config.mjs'), 'utf8');
    const rest = source.slice(source.indexOf('\nexport const FILE_POLICIES'));
    const config = {...CONFIG, privateModeration:true, resourcesEndpoint:backend.vars.PUBLIC_API_ORIGIN + '/resources',
      submissionEndpoint:backend.vars.PUBLIC_API_ORIGIN + '/submit', googleClientId, turnstileSiteKey};
    await writeFile(resolve(output, 'js/config.mjs'), `// Production private moderation. No secrets.\nexport const CONFIG = ${JSON.stringify(config, null, 2)};\n${rest}`);
  }
  const migrations = await Promise.all(MIGRATIONS.map(async name => ({name,
    sha256:createHash('sha256').update(await readFile(resolve(root, 'worker/migrations', name))).digest('hex')})));
  const manifest = {accountId:backend.account_id, worker:backend.name, databaseId,
    databaseName:backend.d1_databases[0].database_name, bucket:backend.r2_buckets[0].bucket_name,
    submissionsEnabled:false, cleanupCron:backend.triggers.crons, pagesPrepared:pages, migrations};
  await writeFile(resolve(configOutput, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return {configOutput, pagesOutput:pages ? output : null, ...manifest};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [settingsPath, ...args] = process.argv.slice(2);
  if (!settingsPath || args.some(arg => arg !== '--pages') || args.length > 1) throw new Error('Usage: node scripts/prepare-production.mjs SETTINGS.json [--pages]. Submissions always stay disabled.');
  console.log(JSON.stringify(await prepareProduction(JSON.parse(await readFile(settingsPath, 'utf8')), {pages:args.includes('--pages')}), null, 2));
}
