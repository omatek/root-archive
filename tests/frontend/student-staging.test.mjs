import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {prepareStudentStaging, STUDENT_ORIGIN, API_ORIGIN} from '../../scripts/prepare-student-staging.mjs';
import {syntheticStudentPDF} from '../../scripts/synthetic-student-pdf.mjs';

test('paused setup shows missing Google configuration and makes no sign-in or submission requests',async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  await mkdir(resolve(root,'dist'),{recursive:true});
  const temp=await mkdtemp(resolve(root,'dist/student-paused-browser-'));
  const output=resolve(temp,'site');
  await prepareStudentStaging({pausedSetup:true,turnstileSiteKey:'0x4SYNTHETIC_STAGING_WIDGET',output,configOutput:resolve(temp,'configs')});
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();const blocked=[];
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.href===API_ORIGIN+'/resources') return route.fulfill({json:{resources:[],next_cursor:null}});
      if(url.origin==='https://challenges.cloudflare.com') return route.fulfill({contentType:'text/javascript',body:'window.turnstile={render(){return "widget"}};'});
      if(url.origin!==STUDENT_ORIGIN) {blocked.push(url.href);return route.abort();}
      const path=resolve(output,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!path.startsWith(output+'/')) return route.abort();
      return route.fulfill({contentType:({'.html':'text/html','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)] || 'application/octet-stream',body:await readFile(path)});
    });
    await page.goto(STUDENT_ORIGIN+'/?course=0401212');
    await page.locator('#load-state').waitFor({state:'hidden'});
    await page.locator('.empty-course [data-contribute]').click();
    await page.locator('#auth-message').filter({hasText:/Google sign-in is not configured yet/}).waitFor();
    assert.equal(await page.locator('#google-signin-slot button').count(),0);
    assert.deepEqual(blocked,[]);
  } finally {await browser.close();await rm(temp,{recursive:true,force:true});}
});

test('generated staging UI uses staging OAuth, Turnstile and /submit, preserves denied drafts and returns a private reference (all external services mocked)',async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  await mkdir(resolve(root,'dist'),{recursive:true});
  const temp=await mkdtemp(resolve(root,'dist/student-browser-'));
  const settings={googleClientId:'123456789-synthetic-staging.apps.googleusercontent.com',turnstileSiteKey:'0x4SYNTHETIC_STAGING_WIDGET'};
  const output=resolve(temp,'site');
  await prepareStudentStaging({...settings,output,configOutput:resolve(temp,'configs')});
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();
    const requests=[], errors=[], unexpected=[];
    const jwt=`synthetic.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
    let authStatus=403, submitStatus=403;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const request=route.request(), url=new URL(request.url());
      if(url.origin===STUDENT_ORIGIN) {
        const path=resolve(output,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
        if(!path.startsWith(output+'/')) return route.abort();
        const mime={'.html':'text/html','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(path)] || 'application/octet-stream';
        return route.fulfill({contentType:mime,body:await readFile(path)});
      }
      if(url.href===API_ORIGIN+'/resources') return route.fulfill({json:{resources:[],next_cursor:null}});
      if(url.href===API_ORIGIN+'/auth/verify') {
        requests.push({path:url.pathname,authorization:request.headers().authorization});
        return route.fulfill({status:authStatus,json:{success:authStatus===200,authorized:authStatus===200}});
      }
      if(url.href===API_ORIGIN+'/submit') {
        requests.push({path:url.pathname,body:request.postData(),authorization:request.headers().authorization});
        return route.fulfill({status:submitStatus,json:submitStatus===201?{success:true,submission_id:'12345678-1234-4123-8123-123456789abc'}:
          {success:false,error:submitStatus===403?'Turnstile verification failed.':'Contributions are temporarily unavailable.'}});
      }
      if(url.href==='https://accounts.google.com/gsi/client') return route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{id:{initialize(o){window.gsiOptions=o},renderButton(slot){const b=document.createElement('button');b.type='button';b.textContent='Mock Google sign-in';b.onclick=()=>window.gsiOptions.callback({credential:${JSON.stringify(jwt)}});slot.append(b)},disableAutoSelect(){}}}};`});
      if(url.origin==='https://challenges.cloudflare.com') return route.fulfill({contentType:'text/javascript',body:`window.turnstile={render(slot,o){window.securityOptions=o;o.callback('synthetic-challenge');return 'widget'},reset(){window.securityOptions.callback('synthetic-challenge')},isExpired(){return false}};`});
      unexpected.push(url.origin+url.pathname);return route.abort();
    });
    await page.goto(STUDENT_ORIGIN+'/?course=0401212');
    await page.locator('#load-state').waitFor({state:'hidden'});
    await page.locator('.empty-course [data-contribute]').click();
    await page.locator('#contribution-title').fill('Synthetic student acceptance');
    await page.locator('#contribution-type').selectOption('Summary');
    await page.locator('#contribution-file').setInputFiles({name:'student-acceptance.pdf',mimeType:'application/pdf',buffer:syntheticStudentPDF()});
    await page.getByRole('button',{name:'Mock Google sign-in',exact:true}).click();
    await page.locator('#auth-message').filter({hasText:/isn’t currently eligible/}).waitFor();
    assert.equal(await page.locator('#contribution-title').inputValue(),'Synthetic student acceptance');
    authStatus=200;
    await page.getByRole('button',{name:'Mock Google sign-in',exact:true}).click();
    await page.getByText('Student account verified.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.gsiOptions.client_id),settings.googleClientId);
    assert.equal(await page.evaluate(()=>window.securityOptions.sitekey),settings.turnstileSiteKey);
    await page.locator('#contribution-declaration').check();
    await page.locator('#submit-resource').click();
    await page.locator('#submission-message').filter({hasText:/security check was not accepted/}).waitFor();
    assert.equal(await page.locator('#signout').isVisible(),true);
    submitStatus=503;
    await page.locator('#submit-resource').click();
    await page.locator('#submission-message').filter({hasText:/couldn’t confirm/}).waitFor();
    assert.match(await page.locator('#selected-file').innerText(),/student-acceptance.pdf/);
    submitStatus=201;
    await page.locator('#submit-resource').click();
    await page.locator('#contribution-success').waitFor();
    assert.match(await page.locator('#submission-reference').innerText(),/12345678-1234-4123-8123-123456789abc/);
    assert.equal(await page.locator('#contribution-success a').count(),0);
    assert(requests.every(r=>r.authorization===`Bearer ${jwt}`));
    assert(requests.filter(r=>r.path==='/submit').every(r=>r.body.includes('%PDF-1.4')&&!r.body.includes('name="contributor"')));
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  } finally {await browser.close();await rm(temp,{recursive:true,force:true});}
});
