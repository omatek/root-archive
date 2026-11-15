// Local preparation only. This module never contacts or changes Cloudflare.
import {cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {CONFIG} from '../site/js/config.mjs';
import {syntheticStudentPDF} from './synthetic-student-pdf.mjs';

export const STUDENT_ORIGIN = 'https://archive-staging.rootamman.com';
export const API_ORIGIN = 'https://api-staging.rootamman.com';
const root = fileURLToPath(new URL('../', import.meta.url));
const jsonc = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\s*\/\/.*$/gm, ''));

export async function prepareStudentStaging({googleClientId, turnstileSiteKey, enabled = false,
  output = resolve(root, 'dist/student-staging'), configOutput = resolve(root, 'worker/.wrangler/student-acceptance')} = {}) {
  if (!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(googleClientId || '') || googleClientId === CONFIG.googleClientId) {
    throw new Error('Supply a distinct staging Google Web client ID via STAGING_GOOGLE_CLIENT_ID.');
  }
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(turnstileSiteKey || '') || turnstileSiteKey === CONFIG.turnstileSiteKey || /^.[xX]00000000000000000000/.test(turnstileSiteKey)) {
    throw new Error('Supply a distinct real staging widget key via STAGING_TURNSTILE_SITE_KEY.');
  }
  if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
  // Only remove an output directory owned by this build, never the source site.
  if (resolve(output) === resolve(root, 'site') || !resolve(output).startsWith(resolve(root, 'dist') + '/')) {
    throw new Error('Frontend output must be under this repository dist/.');
  }
  await rm(output, {recursive:true, force:true});
  await cp(resolve(root, 'site'), output, {recursive:true});
  const sourceConfig = await readFile(resolve(root, 'site/js/config.mjs'), 'utf8');
  const policies = sourceConfig.slice(sourceConfig.indexOf('\nexport const FILE_POLICIES'));
  const config = {...CONFIG, privateModeration:true, resourcesEndpoint:API_ORIGIN + '/resources',
    submissionEndpoint:API_ORIGIN + '/submit', googleClientId, turnstileSiteKey};
  await writeFile(resolve(output, 'js/config.mjs'), `// Isolated staging build. No secrets.\nexport const CONFIG = ${JSON.stringify(config, null, 2)};\n${policies}`);
  let html = await readFile(resolve(output, 'index.html'), 'utf8');
  html = html.replace('<body>', '<body>\n  <p role="note" class="shell">Synthetic staging acceptance only. Do not upload real academic material or personal information.</p>')
    .replaceAll('https://archive.rootamman.com/', STUDENT_ORIGIN + '/');
  await writeFile(resolve(output, 'index.html'), html);
  await writeFile(resolve(output, 'resources.json'), '[]\n');
  await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  await writeFile(resolve(output, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: no-store\n  Referrer-Policy: strict-origin-when-cross-origin\n');

  const frontend = await jsonc(resolve(root, 'worker/wrangler.student-staging.jsonc'));
  frontend.assets.directory = resolve(output);
  frontend.routes = [{pattern:new URL(STUDENT_ORIGIN).hostname, custom_domain:true,
    zone_id:'fc80d6a45a703d0fe4d1876f1380870f'}];
  const backend = await jsonc(resolve(root, 'worker/wrangler.moderation.jsonc'));
  backend.main = resolve(root, 'worker/moderation.ts');
  backend.assets.directory = resolve(root, 'admin');
  backend.d1_databases[0].migrations_dir = resolve(root, 'worker/migrations');
  backend.routes = [backend.vars.ADMIN_ORIGIN, API_ORIGIN].map(origin => ({pattern:new URL(origin).hostname,
    custom_domain:true, zone_id:'fc80d6a45a703d0fe4d1876f1380870f'}));
  delete backend.vars.ADMIN_EMAILS; // Preserve existing deployed secret.
  delete backend.vars.STAGING_STUDENT_EMAILS; // Set via protected secret file.
  backend.secrets = {required:['ADMIN_EMAILS', 'STAGING_STUDENT_EMAILS', 'TURNSTILE_SECRET']};
  backend.vars.GOOGLE_CLIENT_ID = googleClientId;
  backend.vars.SUBMISSIONS_ENABLED = String(enabled);
  await mkdir(configOutput, {recursive:true});
  await writeFile(resolve(configOutput, 'frontend.json'), JSON.stringify(frontend, null, 2) + '\n');
  await writeFile(resolve(configOutput, 'moderation.json'), JSON.stringify(backend, null, 2) + '\n');
  const pdf = syntheticStudentPDF();
  const pdfPath = resolve(root, 'dist/student-acceptance.pdf');
  await writeFile(pdfPath, pdf);
  await writeFile(resolve(configOutput, 'manifest.json'), JSON.stringify({studentOrigin:STUDENT_ORIGIN,
    apiOrigin:API_ORIGIN, submissionsEnabled:enabled, config,
    fixture:{path:pdfPath, bytes:pdf.length, sha256:createHash('sha256').update(pdf).digest('hex')}}, null, 2) + '\n');
  return {output, configOutput, submissionsEnabled:enabled};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--enable-submissions')) throw new Error('Only --enable-submissions is supported. Default is paused.');
  console.log(JSON.stringify(await prepareStudentStaging({googleClientId:process.env.STAGING_GOOGLE_CLIENT_ID,
    turnstileSiteKey:process.env.STAGING_TURNSTILE_SITE_KEY, enabled:args.includes('--enable-submissions')})));
}
