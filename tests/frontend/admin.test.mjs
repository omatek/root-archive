import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {chromium} from 'playwright';

// Browser tests use synthetic API responses and generated images. No live Access,
// Cloudflare, Google, storage or third-party conversion request is made.
const root=resolve(fileURLToPath(new URL('../../admin/',import.meta.url)));
const course=JSON.parse(await readFile(new URL('../../site/courses.json',import.meta.url)))[0];
const id='11111111-1111-4111-8111-111111111111', revision='22222222-2222-4222-8222-222222222222';
const secondRevision='33333333-3333-4333-8333-333333333333';
let server,browser,origin;
function crc32(bytes){let value=0xffffffff;for(const b of bytes){value^=b;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(type,data){const label=Buffer.from(type),body=Buffer.concat([label,data]),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE(crc32(body),out.length-4);return out;}
function png(width=8,height=6){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(width*3+1)+1+x*3;pixels[at]=200;pixels[at+1]=120;pixels[at+2]=40;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Comment\0private-student-number-synthetic')),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const image=png();
const axeSource=await readFile(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url),'utf8');
function fixture(){return {submission:{id,course_id:course.id,type:'Summary',title:'Synthetic scan',semester:'Fall 2026',contributor:null,contributor_email:'synthetic@std.aum.edu.jo',contributor_sub:'synthetic',created_at:'2026-11-01T10:00:00Z',updated_at:'2026-11-01T10:00:00Z',status:'pending',version:1,original_revision_id:revision,candidate_revision_id:revision,reason:null},revisions:[{id:revision,mime:'image/png',filename:'synthetic.png',size:image.length,status:'ready',created_at:'2026-11-01T10:00:00Z',created_by:'student',kind:'original'}],audit:[{action:'submission_received',actor:'student',created_at:'2026-11-01T10:00:00Z'}],published:null};}
before(async()=>{
  server=createServer(async(req,res)=>{
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403).end();return;}
    try{const file=path===root?resolve(root,'index.html'):path;const bytes=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404).end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
});
after(async()=>{await browser?.close();await new Promise(done=>server?.close(done));});
async function setup(options={}){
  const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1440,height:1000}}),page=await context.newPage();
  let record=fixture(),metadataFailures=options.metadataFailures||0;const calls=[],errors=[];
  if(options.title)record.submission.title=options.title;
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin==='https://downloads.example.invalid')return route.fulfill({status:record.submission.status==='published'?200:404,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},body:''});
    if(url.origin!==origin)return route.abort();
    if(!url.pathname.startsWith('/admin/api'))return route.continue();
    calls.push({path:url.pathname,method:req.method(),headers:req.headers(),body:req.postData()});
    const json=(body,status=200)=>route.fulfill({status,json:body});
    const path=url.pathname.slice('/admin/api'.length);
    if(path==='/session')return json(options.denySession?{error:'Forbidden'}:{email:'moderator@example.invalid'},options.denySession?403:200);
    if(path==='/courses')return json({courses:[course]});
    if(path==='/submissions')return json({submissions:[record.submission],next_cursor:null});
    if(path==='/cleanup')return json({success:true});
    if(path===`/submissions/${id}`)return json(record);
    if(path.startsWith(`/submissions/${id}/files/`))return route.fulfill({contentType:'image/png',body:image});
    const action=path.split('/').at(-1);
    if(action==='metadata'&&metadataFailures-->0)return json({success:false,error:'Changed'},409);
    if(action==='revisions'){
      record.revisions.push({id:secondRevision,mime:'image/png',filename:'cleaned-resource.png',size:image.length,status:'ready',created_at:'2026-11-02T10:00:00Z',created_by:'moderator@example.invalid',kind:'replacement'});record.submission.candidate_revision_id=secondRevision;
    }else{
      const body=req.postDataJSON();assert.equal(body.version,record.submission.version);
      if(action==='metadata')for(const key of ['title','course_id','type','semester','contributor'])record.submission[key]=body[key];
      if(action==='review')record.submission.status='under_review';
      if(action==='approve'){
        assert.equal(body.revision_id,record.submission.candidate_revision_id);record.submission.status='published';
        record.published={...record.submission,revision_id:body.revision_id,published_at:'2026-11-02T10:00:00Z',asset_url:`https://downloads.example.invalid/download/${id}`};
      }
      if(action==='unpublish'){record.submission.status='unpublished';record.published.status='unpublished';}
      if(['remove','reject'].includes(action)){
        record.submission.status=action==='remove'?'removed':'rejected';record.submission.reason=body.reason;record.submission.contributor_email=null;record.submission.contributor_sub=null;
        for(const r of record.revisions)r.status='deleting';if(record.published)record.published.status=record.submission.status;
      }
    }
    record.submission.version++;record.audit.push({action,actor:'moderator@example.invalid',created_at:'2026-11-02T10:00:00Z'});return json(record);
  });
  await page.goto(origin);await page.getByText(options.denySession?'Your Access session is unavailable or this identity is not an administrator. Your draft has been kept.':'1 record loaded.',{exact:true}).waitFor();
  return {page,context,calls,record:()=>record,async close(){assert.deepEqual(errors,[]);await context.close();}};
}
async function open(s){await s.page.locator('.record button').click();await s.page.locator('#detail-dialog').waitFor({state:'visible'});}

test('portal saves private candidate, approves, unpublishes and permanently removes with distinct confirmations',async()=>{
  const s=await setup();const p=s.page;try{
    await open(s);assert.match(await p.locator('#contributor-info').innerText(),/synthetic@std.aum.edu.jo/);
    await p.locator('#meta-title').fill('Cleaned synthetic summary');await p.locator('#save-metadata').click();await p.getByText('Candidate metadata saved. Inspect and approve it before publication.',{exact:true}).waitFor();
    await p.locator('#replacement-file').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:image});await p.locator('#upload-replacement').click();await p.getByText('Replacement saved privately and selected as the candidate. Preview it before approval.',{exact:true}).waitFor();
    assert.equal(s.record().published,null);assert.equal(s.record().submission.candidate_revision_id,secondRevision);
    await p.locator('#review-check').check();await p.locator('#approve').click();await p.getByText('Selected candidate published. Anonymous downloads are enabled for this resource.',{exact:true}).waitFor();
    assert.equal(s.record().published.revision_id,secondRevision);
    await p.locator('#check-public').click();await p.getByText('Anonymous download is currently available.',{exact:true}).waitFor();
    await p.locator('#unpublish').click();assert.match(await p.locator('#decision-explanation').innerText(),/Files stay private for editing and later approval/);await p.locator('#decision-reason').fill('Fix missing page');await p.locator('#confirm-decision').click();await p.getByText('Public access revoked. The file is retained privately for re-review.',{exact:true}).waitFor();
    assert.equal(s.record().submission.status,'unpublished');assert.equal(s.record().revisions.length,2);
    await p.locator('#check-public').click();await p.getByText('Anonymous download is unavailable.',{exact:true}).waitFor();
    await p.locator('#remove').click();assert.match(await p.locator('#decision-explanation').innerText(),/Previously downloaded copies cannot be recalled/);await p.locator('#decision-reason').fill('Synthetic permanent removal');await p.locator('#confirm-decision').click();await p.getByText('Public access revoked. File cleanup is queued and will retry after failures.',{exact:true}).waitFor();
    assert.equal(s.record().submission.status,'removed');assert.equal(await p.locator('#approve').isVisible(),false);
    const writes=s.calls.filter(c=>c.method==='POST');assert.ok(writes.length>=5);assert.ok(writes.every(c=>c.headers['x-requested-with']==='root-admin'));
  }finally{await s.close();}
});

test('conflicting changes retain administrator metadata draft; submitted text renders inertly',async()=>{
  const title='<img src=x onerror=alert(1)> synthetic';const s=await setup({metadataFailures:1,title});try{
    await open(s);assert.equal(await s.page.locator('#detail-heading').innerText(),title);assert.equal(await s.page.locator('#detail-heading img').count(),0);
    await s.page.locator('#meta-title').fill('Unsaved administrator draft');await s.page.locator('#save-metadata').click();await s.page.getByText(/This record changed elsewhere/).waitFor();
    assert.equal(await s.page.locator('#meta-title').inputValue(),'Unsaved administrator draft');assert.equal(s.record().submission.title,title);
  }finally{await s.close();}
});

test('session denial fails closed and offers reauthentication without another password',async()=>{
  const s=await setup({denySession:true});try{
    assert.equal(await s.page.locator('#session-recovery').isVisible(),true);assert.equal(await s.page.locator('.record').count(),0);
    assert.equal(s.calls.some(c=>c.path.includes('/submissions')),false);assert.equal(await s.page.locator('#refresh').isDisabled(),true);
  }finally{await s.close();}
});

test('raster export rotates, crops, adjusts and permanently replaces redacted pixels without original metadata',async()=>{
  const s=await setup();try{
    const result=await s.page.evaluate(async bytes=>{
      const {decodeRaster,renderRaster,exportPNG}=await import('/js/image-editor.mjs');
      const source=await decodeRaster(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
      const canvas=document.createElement('canvas');
      renderRaster(source,canvas,{rotation:90,crop:{x:1,y:2,width:4,height:4},brightness:150,contrast:180,grayscale:true,scan:true,redactions:[{x:1,y:1,width:2,height:2}]});
      const blob=await exportPNG(canvas),exportBytes=new Uint8Array(await blob.arrayBuffer());
      const decoded=await createImageBitmap(blob),flat=document.createElement('canvas');flat.width=decoded.width;flat.height=decoded.height;const context=flat.getContext('2d');context.drawImage(decoded,0,0);const pixel=(x,y)=>[...context.getImageData(x,y,1,1).data];
      source.close();decoded.close();return {width:flat.width,height:flat.height,redacted:pixel(1,1),background:pixel(0,0),hasPrivateMetadata:new TextDecoder().decode(exportBytes).includes('private-student-number'),mime:blob.type};
    },[...image]);
    assert.deepEqual(result,{width:4,height:4,redacted:[0,0,0,255],background:[255,255,255,255],hasPrivateMetadata:false,mime:'image/png'});
    const overflow=await s.page.evaluate(async()=>{
      const {decodeRaster}=await import('/js/image-editor.mjs');const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(16,100000);view.setUint32(20,100000);try{await decodeRaster(new Blob([bytes],{type:'image/png'}));return '';}catch(e){return e.message;}
    });assert.match(overflow,/12 megapixels/);
  }finally{await s.close();}
});

test('image editing requires final inspection and uploads a fresh private PNG candidate; mobile controls fit',async()=>{
  const s=await setup({mobile:true});const p=s.page;try{
    await open(s);await p.getByRole('button',{name:'Edit image',exact:true}).click();await p.locator('#editor-dialog').waitFor({state:'visible'});
    assert.equal(await p.locator('#save-edited').isDisabled(),true);await p.locator('#rotate-right').click();
    await p.locator('#redact-x').fill('0');await p.locator('#redact-y').fill('0');await p.locator('#redact-width').fill('2');await p.locator('#redact-height').fill('2');await p.locator('#add-redaction').click();
    await p.locator('#editor-inspected').check();await p.locator('#save-edited').click();await p.locator('#editor-dialog').waitFor({state:'hidden'});
    assert.equal(s.record().submission.candidate_revision_id,secondRevision);assert.equal(s.record().published,null);
    const request=s.calls.find(c=>c.path.endsWith('/revisions'));assert.match(request.headers['content-type'],/^multipart\/form-data/);assert.ok(request.body.includes('cleaned-resource.png'));
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    assert.equal(await p.locator('dialog[open]').evaluateAll(ds=>ds.some(d=>d.scrollWidth>d.clientWidth+1)),false);
  }finally{await s.close();}
});

test('desktop and mobile moderation controls pass automated accessibility checks',async()=>{
  for(const mobile of [false,true]){
    const s=await setup({mobile});const p=s.page;try{
      await p.evaluate(axeSource);
      for(const surface of ['queue','detail','editor']){
        if(surface==='detail')await open(s);
        if(surface==='editor'){await p.getByRole('button',{name:'Edit image',exact:true}).click();await p.locator('#editor-dialog').waitFor({state:'visible'});}
        const result=await p.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
        assert.deepEqual(result.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),[],`${mobile?'mobile':'desktop'} ${surface}`);
      }
      if(process.env.ADMIN_SCREENSHOTS==='1'){
        await p.locator('#close-editor').click();
        await p.locator('#detail-dialog').evaluate(dialog=>{dialog.scrollTop=0;});
        await p.screenshot({path:mobile?'/tmp/root-admin-mobile.png':'/tmp/root-admin-desktop.png',fullPage:true});
      }
    }finally{await s.close();}
  }
});
