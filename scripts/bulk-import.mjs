#!/usr/bin/env node
import {readFile, mkdir, open, unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseArgs} from 'node:util';
import {scanDirectory, validateManifest, verifyFiles, inspectFile, saveManifest, summary, classificationPacket,
  mergeClassifications, parseClassificationCSV, isSelected, entryRequestHash, IMPORT_ATTESTATION} from './bulk-import-manifest.mjs';
import {OPERATION_ID} from '../shared/operator-import.mjs';
const exec = promisify(execFile);
const readManifest = async filename => validateManifest(JSON.parse(await readFile(filename,'utf8')));
export function validateOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.origin!==value || url.username || url.password) throw new Error('--origin must be an exact HTTPS administrator origin.');
  return url.origin;
}
export async function accessToken(origin) {
  // cloudflared stores its own session. Never persist, echo, or pass a token on
  // a command line. execFile prevents shell interpolation of operator input.
  try {
    const {stdout}=await exec('cloudflared',['access','token',`--app=${origin}`],{maxBuffer:32768,timeout:60000});
    const token=stdout.trim();
    if(token.length>16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    return token;
  } catch {throw new Error(`Access token unavailable. Run cloudflared access login ${origin}, then retry. Token output is never logged.`);}
}
function validReceipt(receipt,entry) {
  return receipt?.success===true && receipt.import_status==='imported' && receipt.operation_id===entry.operation_id &&
    receipt.file_sha256===entry.sha256 && receipt.request_sha256===entryRequestHash(entry) && OPERATION_ID.test(receipt.submission_id) && typeof receipt.accepted_at==='string';
}
export async function uploadManifest(manifest,{origin,token,fetcher=fetch,persist=async()=>{},execute=false,attest=false,onProgress=()=>{}}) {
  origin=validateOrigin(origin);
  await verifyFiles(manifest); // Entire selected batch is validated before auth or writes.
  if(!execute) return summary(manifest);
  if(!attest) throw new Error('Upload requires --attest-permission and --execute, plus reviewed, attested entries.');
  if(!manifest.entries.some(isSelected)) return summary(manifest);
  token=token??await accessToken(origin);
  const request=async(route,{method='GET',body}={})=>{
    let response;
    try {response=await fetcher(origin+route,{method,body,redirect:'manual',signal:AbortSignal.timeout(120000),
      headers:{'Cf-Access-Token':token,Origin:origin,'X-Requested-With':'root-admin',Accept:'application/json'}});}
    catch {throw new Error('Network outcome unconfirmed. Retry the same manifest and operation ID.');}
    if([301,302,303,307,308,401,403].includes(response.status)) {
      const error=new Error('Access session failed or expired. Sign in again; retry the same manifest.');error.authentication=true;throw error;
    }
    const payload=await response.json().catch(()=>null);
    if(!payload) throw new Error('Server returned no JSON receipt. Outcome unconfirmed; retry the same manifest.');
    return {response,payload};
  };
  const session=await request('/admin/api/session');
  if(!session.response.ok || typeof session.payload.email!=='string') throw new Error('Administrator session verification failed; no uploads attempted.');
  const selected=manifest.entries.filter(isSelected),lookups=new Map();
  // Read-only lookup for the whole batch catches expired/misrouted sessions and
  // known duplicates before the first POST. Nothing touches R2 during preflight.
  for(const entry of selected) {
    const lookup=await request(`/admin/api/import/${entry.operation_id}?file_sha256=${entry.sha256}`);
    if(![200,404,409].includes(lookup.response.status)) throw new Error('Import preflight failed; no uploads attempted. Check endpoint deployment and migration.');
    if(lookup.response.status===404 && lookup.payload.code!=='import_not_found') throw new Error('Operator import endpoint is unavailable; no uploads attempted.');
    if(lookup.response.ok && (lookup.payload.file_sha256!==entry.sha256 || lookup.payload.request_sha256!==entryRequestHash(entry))) {
      throw new Error('Operation ID belongs to a different reviewed payload. Restore the manifest or use the moderation portal for accepted corrections.');
    }
    lookups.set(entry.file_id,lookup);
  }
  for(const entry of selected) {
    let shouldStop=false;
    const lookup=lookups.get(entry.file_id);
    if(validReceipt(lookup.payload,entry)) {
      entry.receipt=lookup.payload;entry.import_status='imported';entry.error=null;
    } else if(lookup.payload.code==='duplicate_content') {
      entry.import_status='duplicate';entry.error=`Content already recorded. Review ${OPERATION_ID.test(lookup.payload.submission_id)?lookup.payload.submission_id:'the existing submission'} in the moderation portal.`;
    } else if(lookup.response.ok && lookup.payload.file_sha256!==entry.sha256) {
      throw new Error('Operation ID belongs to different content. Restore the manifest before retrying.');
    } else if(lookup.payload.import_status==='receiving') {
      entry.import_status='unknown';entry.error='Previous upload is still receiving. Retry after the one-hour upload deadline and cleanup.';
    } else {
      const current=await inspectFile(manifest.document_root,entry.source_path);
      if(current.sha256!==entry.sha256 || current.size!==entry.size || current.mime!==entry.mime) throw new Error('File changed after preflight. No further uploads attempted.');
      const data=new FormData();
      for(const [key,value] of Object.entries({operation_id:entry.operation_id,file_sha256:entry.sha256,course_id:entry.course_id,
        title:entry.title,type:entry.type,academic_term:JSON.stringify(entry.academic_term),permission_attested:'true',attestation_version:IMPORT_ATTESTATION.version})) data.set(key,value);
      data.set('file',new File([current.bytes],entry.original_filename,{type:entry.mime}));
      entry.import_status='unknown';entry.error='Upload started; outcome not yet confirmed.';
      await persist(manifest); // Persist operation and uncertainty before sending bytes.
      try {
        const {response,payload}=await request('/admin/api/import',{method:'POST',body:data});
        if(validReceipt(payload,entry) && response.ok) {entry.import_status='imported';entry.receipt=payload;entry.error=null;}
        else if(payload.code==='duplicate_content') {entry.import_status='duplicate';entry.error=`Content already recorded. Review ${OPERATION_ID.test(payload.submission_id)?payload.submission_id:'the existing submission'} in the moderation portal.`;}
        else {
          entry.import_status=response.status>=500 || ['import_in_progress','import_unconfirmed'].includes(payload.code)?'unknown':'failed';
          // Do not persist arbitrary service responses or sensitive intermediary HTML.
          entry.error=`Import returned HTTP ${response.status}; code ${['operation_conflict','cleanup_pending','import_in_progress','import_unconfirmed'].includes(payload.code)?payload.code:'request_rejected'}. Keep the same operation ID for retry.`;
        }
      } catch(error) {entry.import_status='unknown';entry.error=error.message;shouldStop=!!error.authentication;}
    }
    await persist(manifest);onProgress(entry.file_id,entry.import_status);
    if(shouldStop) throw new Error('Administrator authentication failed mid-batch. Results saved; sign in and retry the same manifest.');
  }
  return summary(manifest);
}

export async function main(args=process.argv.slice(2)) {
  const command=args.shift();
  const {values}=parseArgs({args,options:{dir:{type:'string'},manifest:{type:'string'},packet:{type:'string'},classifications:{type:'string'},origin:{type:'string'},'dry-run':{type:'boolean'},execute:{type:'boolean'},'attest-permission':{type:'boolean'},help:{type:'boolean'}}});
  if(values.help || command==='help' || !command) {
    console.log('Commands: prepare --dir DIR [--packet FILE], packet --packet FILE, merge --classifications FILE, validate, upload --origin HTTPS_ORIGIN [--dry-run | --execute --attest-permission]. All accept --manifest FILE (default work/import-manifest.json). See docs/operator-import.md.');return;
  }
  const filename=path.resolve(values.manifest??'work/import-manifest.json');
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const lock=await open(filename+'.lock','wx',0o600).catch(()=>{throw new Error('Manifest is locked. Stop any other importer; remove the stale .lock file only after verifying no importer is running.');});
  try {
    await lock.writeFile(String(process.pid));
    if(command==='prepare') {
      if(!values.dir) throw new Error('prepare requires --dir.');
      const manifest=await scanDirectory(values.dir);
      await saveManifest(filename,manifest,{exclusive:true}); // Never overwrite reviews/receipts.
      if(values.packet) await writePacket(values.packet,manifest);
      console.log(JSON.stringify(summary(manifest)));return;
    }
    const manifest=await readManifest(filename);
    if(command==='packet') {if(!values.packet) throw new Error('packet requires --packet output.json.');await writePacket(values.packet,manifest);}
    else if(command==='merge') {
      if(!values.classifications) throw new Error('merge requires --classifications JSON-or-CSV.');
      const source=await readFile(values.classifications,'utf8');
      const results=path.extname(values.classifications).toLowerCase()==='.csv'?parseClassificationCSV(source):JSON.parse(source);
      const merged=mergeClassifications(manifest,results);await saveManifest(filename,merged);console.log(JSON.stringify(summary(merged)));return;
    } else if(command==='validate') await verifyFiles(manifest);
    else if(command==='upload') {
      if(!values.origin) throw new Error('upload requires --origin https://moderation.rootamman.com (or the approved staging admin origin).');
      if(values['dry-run'] && values.execute) throw new Error('Choose --dry-run or --execute.');
      let result;
      try {result=await uploadManifest(manifest,{origin:values.origin,execute:!!values.execute,attest:!!values['attest-permission'],
        persist:m=>saveManifest(filename,m),onProgress:(id,status)=>console.log(`${id}: ${status}`)});
      } catch(error) {console.log(JSON.stringify(summary(manifest)));throw error;}
      console.log(JSON.stringify(result));
      if(result.failed || result.unconfirmed || result.duplicates) process.exitCode=1;
      return;
    } else throw new Error('Commands: prepare, packet, merge, validate, upload. See docs/operator-import.md.');
    console.log(JSON.stringify(summary(manifest)));
  } finally {await lock.close();await unlink(filename+'.lock');}
}
async function writePacket(filename,manifest) {
  const file=await open(filename,'wx',0o600);
  try {await file.writeFile(JSON.stringify(classificationPacket(manifest),null,2)+'\n');} finally {await file.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
