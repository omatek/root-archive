import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {scanDirectory,validateManifest,verifyFiles,classificationPacket,mergeClassifications,parseClassificationCSV,saveManifest,courses,IMPORT_ATTESTATION,summary,entryRequestHash} from './bulk-import-manifest.mjs';
import {uploadManifest,main} from './bulk-import.mjs';
import {normalizeTerm,MAX_IMPORT_FILE} from '../shared/operator-import.mjs';
const course=courses[0];
let directory;
test.beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'root-import-test-'));});
test.afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
const scanned=async()=>{await writeFile(path.join(directory,'one.pdf'),'%PDF-synthetic');return scanDirectory(directory);};
const classification=entry=>({file_id:entry.file_id,course_id:course.id,title:'Synthetic notes',type:'Notes',academic_term:{academic_year:'2024-2025',semester:'Fall'},confidence:0.9,explanation:'Synthetic course evidence.',uncertainty:[]});
const ready=async()=>{const m=await scanned();Object.assign(m.entries[0],classification(m.entries[0]),{review_status:'ready',permission_attested:true});delete m.entries[0].confidence;delete m.entries[0].explanation;delete m.entries[0].uncertainty;return m;};
const receipt=e=>({success:true,operation_id:e.operation_id,submission_id:randomUUID(),file_sha256:e.sha256,request_sha256:entryRequestHash(e),accepted_at:new Date().toISOString(),import_status:'imported',moderation_status:'pending'});
const response=(body,status=200)=>Response.json(body,{status});
const absent=()=>response({code:'import_not_found'},404);
const origin='https://moderation.example.invalid';

test('scan preserves all supported/unsupported inputs, duplicate bytes, invalid signatures and symlinks',async()=>{
  await writeFile(path.join(directory,'one.pdf'),'%PDF-synthetic');await writeFile(path.join(directory,'two.pdf'),'%PDF-synthetic');
  await writeFile(path.join(directory,'script.exe'),'do not execute');await writeFile(path.join(directory,'bad.jpg'),'bad');
  await writeFile(path.join(directory,'good.jpg'),Buffer.from([255,216,255,1]));
  await writeFile(path.join(directory,'good.png'),Buffer.from([137,80,78,71,13,10,26,10,1]));
  await writeFile(path.join(directory,'good.docx'),Buffer.from([80,75,3,4,1]));await writeFile(path.join(directory,'good.zip'),Buffer.from([80,75,3,4,2]));
  await symlink(path.join(directory,'one.pdf'),path.join(directory,'link.pdf'));
  const m=await scanDirectory(directory);assert.equal(m.entries.length,9);assert.equal(summary(m).duplicates,1);
  assert.equal(m.entries.filter(e=>e.issues.length).length,4);
  assert.ok(m.entries.every(e=>e.review_status==='needs_review' && !e.permission_attested));
  const again=await scanDirectory(directory);assert.deepEqual(again.entries.map(e=>e.file_id),m.entries.map(e=>e.file_id));
});
test('manifest rejects unknown courses/types, forged fields, repeated IDs and unattested ready entries',async()=>{
  const base=await ready();validateManifest(base);
  for(const patch of [{course_id:'9999999'},{type:'Past Paper'},{permission_attested:false},{size:MAX_IMPORT_FILE+1},{size:0},{mime:'text/html'},{source_path:'../escape.pdf'},{contributor:'Author'},{review_status:'approved'},{sha256:'bad'},{title:'<script>bad</script>'}]) {
    const m=structuredClone(base);Object.assign(m.entries[0],patch);assert.throws(()=>validateManifest(m));
  }
  const repeated=structuredClone(base);repeated.entries.push({...repeated.entries[0]});assert.throws(()=>validateManifest(repeated));
  const unreviewed=await scanned();assert.equal(unreviewed.entries[0].course_id,null);validateManifest(unreviewed);
});
test('academic terms normalize into the existing optional semester string without guessing dates',()=>{
  assert.equal(normalizeTerm({academic_year:'2023-2024',semester:'Spring'}),'Spring 2023-2024');
  assert.equal(normalizeTerm({academic_year:null,semester:null}),'');assert.equal(normalizeTerm({academic_year:'2023-2024',semester:null}),'2023-2024');
  for(const term of [{academic_year:'2024',semester:'Fall'},{academic_year:'2024-2026',semester:'Fall'},{academic_year:null,semester:'Winter'},null,{academic_year:null,semester:null,other:true}]) assert.throws(()=>normalizeTerm(term));
});
test('AI packet contains authoritative choices, strict schema and injection guidance without document bytes or paths',async()=>{
  const m=await scanned(),p=classificationPacket(m),text=JSON.stringify(p);assert.equal(p.courses.length,courses.length);
  assert.deepEqual(p.resource_types,['Practice Questions','Summary','Notes','Test Bank','Other']);
  assert.equal(p.output_schema.items.additionalProperties,false);assert.match(p.prompt,/untrusted/);
  assert.ok(!text.includes('%PDF-synthetic'));assert.ok(!text.includes(directory));
});
test('AI merge validates atomically, preserves unmapped files and revokes any previous approval',async()=>{
  const m=await scanned();await writeFile(path.join(directory,'other.pdf'),'%PDF-other');const two=await scanDirectory(directory);
  const good=classification(two.entries[0]);const merged=mergeClassifications(two,[good]);assert.equal(merged.entries.length,2);assert.equal(merged.entries[0].review_status,'needs_review');
  assert.equal(merged.entries[1].course_id,null);assert.equal(merged.entries[0].permission_attested,false);
  for(const bad of [{...good,course_id:'unknown'},{...good,type:'Lecture'},{...good,confidence:1.01},{...good,file_id:'unknown'},{...good,course_title:'Invented'},{...good,academic_term:{academic_year:'2024-2028',semester:'Fall'}}]) assert.throws(()=>mergeClassifications(two,[bad]));
  assert.throws(()=>mergeClassifications(two,[good,good]));assert.equal(two.entries[0].course_id,null);
  const uncertain=mergeClassifications(m,[{...classification(m.entries[0]),confidence:0.2,academic_term:{academic_year:null,semester:null}}]);
  assert.ok(uncertain.entries[0].classification.uncertainty.length>=2);
});
test('CSV handles quotes, UTF-8, missing metadata and rejects malformed/duplicate mappings',async()=>{
  const m=await scanned(),e=m.entries[0];
  const csv=`file_id,course_id,title,type,academic_year,semester,confidence,explanation,uncertainty\n${e.file_id},${course.id},"Notes, موضوع",Notes,,,0.4,"Says ""review""","[""Uncertain course""]"\n`;
  const values=parseClassificationCSV(csv);assert.equal(values[0].title,'Notes, موضوع');assert.equal(values[0].academic_term.academic_year,null);
  const merged=mergeClassifications(m,values);assert.equal(merged.entries.length,1);
  for(const invalid of ['bad,headers\nx,y','"unterminated',csv.replace('0.4','NaN'),csv.replace('"[""Uncertain course""]"','garbage')]) assert.throws(()=>mergeClassifications(m,parseClassificationCSV(invalid)));
});
test('local file mismatch and oversize/type failures stop before authentication and uploads',async()=>{
  const m=await ready();await writeFile(path.join(directory,'one.pdf'),'%PDF-changed');let calls=0;
  await assert.rejects(uploadManifest(m,{origin,execute:true,attest:true,token:'fixture',fetcher:async()=>{calls++;}}),/mismatch/);assert.equal(calls,0);
  const large=await openLarge();assert.ok(large.entries.find(e=>e.original_filename==='large.pdf').issues.length);
});
async function openLarge(){const {open}=await import('node:fs/promises');const file=await open(path.join(directory,'large.pdf'),'w');await file.truncate(MAX_IMPORT_FILE+1);await file.close();return scanDirectory(directory);}
test('dry run and missing attestation cannot authenticate or upload; auth failure prevents all uploads',async()=>{
  const m=await ready();let calls=0;const fetcher=async()=>{calls++;return response({},403);};
  await uploadManifest(m,{origin,fetcher});assert.equal(calls,0);
  await assert.rejects(uploadManifest(m,{origin,execute:true,token:'fixture',fetcher}),/attest/);assert.equal(calls,0);
  await assert.rejects(uploadManifest(m,{origin,execute:true,attest:true,token:'fixture',fetcher}),/Access session/);assert.equal(calls,1);
});
test('interrupted uploads persist uncertainty and resolve server receipts on retry without another POST',async()=>{
  const m=await ready(),e=m.entries[0],serverReceipt=receipt(e);let posted=false,saves=0;
  const fetcher=async(url,options)=>{
    assert.equal(options.headers['Cf-Access-Token'],'fixture');assert.equal(options.redirect,'manual');
    if(url.endsWith('/session'))return response({email:'operator@example.invalid'});
    if(options.method==='POST'){assert.equal(m.entries[0].import_status,'unknown');posted=true;throw new Error('lost response after commit');}
    return posted?response(serverReceipt):absent();
  };
  const options={origin,execute:true,attest:true,token:'fixture',fetcher,persist:async()=>{saves++;}};
  await uploadManifest(m,options);assert.equal(e.import_status,'unknown');assert.ok(saves>=2);
  await uploadManifest(m,options);assert.equal(e.import_status,'imported');assert.equal(e.receipt.submission_id,serverReceipt.submission_id);
  await uploadManifest(m,options);assert.equal(e.import_status,'imported');
});
test('uploads remain sequential, continue recoverable failures, flag duplicates and stop on authentication expiry',async()=>{
  const m=await ready();await writeFile(path.join(directory,'two.pdf'),'%PDF-second');const other=(await scanDirectory(directory)).entries.find(e=>e.source_path==='two.pdf');
  Object.assign(other,{course_id:course.id,title:'Second fixture',type:'Notes',review_status:'ready',permission_attested:true});m.entries.push(other);
  let posts=0;const result=await uploadManifest(m,{origin,execute:true,attest:true,token:'fixture',fetcher:async(url,options)=>{
    if(url.endsWith('/session'))return response({email:'operator@example.invalid'});if(options.method!=='POST')return absent();
    posts++;return posts===1?response({code:'request_rejected'},400):response(receipt(other),201);
  }});assert.equal(result.failed,1);assert.equal(result.imported,1);assert.equal(posts,2);
  const duplicate=await ready();posts=0;await uploadManifest(duplicate,{origin,execute:true,attest:true,token:'fixture',fetcher:async(url,options)=>{
    if(url.endsWith('/session'))return response({email:'operator@example.invalid'});if(options.method==='POST')posts++;return response({code:'duplicate_content'},409);
  }});assert.equal(posts,0);assert.equal(duplicate.entries[0].import_status,'duplicate');
  m.entries.forEach(e=>{e.import_status='not_started';e.receipt=null;});posts=0;
  await assert.rejects(uploadManifest(m,{origin,execute:true,attest:true,token:'fixture',fetcher:async(url,options)=>{
    if(url.endsWith('/session'))return response({email:'operator@example.invalid'});if(options.method!=='POST')return absent();posts++;return response({},401);
  }}),/mid-batch/);assert.equal(posts,1);
});
test('manifest persistence is private and atomic; prepare never overwrites reviews or operation IDs',async()=>{
  const m=await ready(),filename=path.join(directory,'review.json');await saveManifest(filename,m,{exclusive:true});
  await assert.rejects(saveManifest(filename,m,{exclusive:true}),/EEXIST/);assert.deepEqual(JSON.parse(await readFile(filename,'utf8')),m);
  await assert.rejects(main(['prepare','--dir',directory,'--manifest',filename]),/EEXIST/);
});


test('a recovered operation cannot silently accept changed reviewed metadata, even with identical file bytes',async()=>{
  const m=await ready(),original=receipt(m.entries[0]);m.entries[0].title='Different reviewed title';let posts=0;
  await assert.rejects(uploadManifest(m,{origin,execute:true,attest:true,token:'fixture',fetcher:async(url,options)=>{
    if(url.endsWith('/session'))return response({email:'operator@example.invalid'});if(options.method==='POST')posts++;return response(original);
  }}),/different reviewed payload/);assert.equal(posts,0);
  m.entries[0].receipt=original;m.entries[0].import_status='imported';assert.throws(()=>validateManifest(m),/receipt/);
});
