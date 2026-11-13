import { decodeRaster, renderRaster, rotatedSize, checkedRectangle, exportPNG } from './image-editor.mjs';

const $ = id => document.getElementById(id);
const API = '/admin/api';
const TERMINAL = new Set(['rejected', 'removed']);
const statuses = {pending: 'Pending', under_review: 'Under review', published: 'Published', unpublished: 'Private re-review', rejected: 'Rejected', removed: 'Permanently removed'};
let authorized = false, busy = false, view = 'pending', nextCursor = null, listGeneration = 0;
let courses = [], detail = null, metadataDirty = false, decision = null, previewURL = null;
let source = null, editorOptions = null, editorDirty = false, pointerStart = null;

function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function message(text, target = 'status') { $(target).textContent = text; }
function date(value) { const time = new Date(value); return Number.isFinite(time.getTime()) ? time.toLocaleString() : 'Unknown date'; }
function bytes(value) { return `${(Number(value || 0) / 1024 / 1024).toFixed(2)} MiB`; }
function expired() {
  authorized = false; for (const recovery of document.querySelectorAll('.session-recovery')) recovery.hidden = false;
  message('Access session unavailable. Sign in again, then retry; your draft remains in this tab.');
  paintEnabled();
}
async function api(path, options = {}) {
  const headers = new Headers({Accept: 'application/json', ...options.headers});
  if (options.method && options.method !== 'GET') headers.set('X-Requested-With', 'root-admin');
  let response;
  try { response = await fetch(API + path, {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120000), ...options, headers}); }
  catch { expired(); throw new Error('The connection was interrupted. Your draft remains here. Check the current record before retrying a decision. If the session expired, sign in again in a new tab.'); }
  if (response.status === 401 || response.status === 403 || !response.headers.get('Content-Type')?.includes('application/json')) {
    expired(); throw new Error('Your Access session is unavailable or this identity is not an administrator. Your draft has been kept.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    if (response.status === 409) throw new Error('This record changed elsewhere. Your draft has been kept. Reload the record before retrying; inspect the latest candidate and decision.');
    throw new Error(payload?.error || 'The operation failed. Your draft has been kept. Retry after checking the current record.');
  }
  return payload;
}
function jsonPost(path, payload) { return api(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)}); }
function paintEnabled() {
  const writable = authorized && !busy && detail && !TERMINAL.has(detail.submission.status);
  for (const id of ['save-metadata', 'start-review', 'upload-replacement', 'approve', 'reject', 'unpublish', 'remove', 'save-edited', 'confirm-decision']) $(id).disabled = !writable;
  $('approve').disabled ||= !$('review-check').checked || !(detail?.revisions || []).some(revision => revision.id === detail.submission.candidate_revision_id && revision.status === 'ready');
  $('save-edited').disabled ||= !$('editor-inspected').checked || !source;
  for (const control of $('metadata-form').elements) control.disabled = !writable;
  $('replacement-file').disabled = !writable;
  for (const id of ['refresh', 'load-more', 'retry-cleanup']) $(id).disabled = busy || !authorized;
  $('detail-dialog').setAttribute('aria-busy', String(busy));
}
async function run(work, target = 'detail-status') {
  if (busy) return;
  busy = true; paintEnabled();
  try { await work(); }
  catch (error) { message(error.message || 'Operation failed.', target); }
  finally { busy = false; paintEnabled(); }
}
function recordPath() { return `/submissions/${encodeURIComponent(detail.submission.id)}`; }
function filePath(revisionId) { return API + recordPath() + `/files/${encodeURIComponent(revisionId)}`; }
async function fileBlob(revision) {
  let response;
  try { response = await fetch(filePath(revision.id), {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120000)}); }
  catch { expired(); throw new Error('Private download could not be confirmed. Check your connection or sign in again, then retry.'); }
  if (response.status === 401 || response.status === 403) { expired(); throw new Error('Sign in again to inspect private files.'); }
  if (!response.ok) throw new Error('This private revision is unavailable. Refresh the record and retry.');
  const blob = await response.blob();
  if (blob.size > 24 * 1024 * 1024) throw new Error('File exceeds the browser tool limit. Inspect it locally.');
  if (blob.type !== revision.mime) throw new Error('File type did not match the private revision record.');
  return blob;
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function loadRecords(append = false) {
  const generation = ++listGeneration;
  message('Loading moderation records…');
  const query = new URLSearchParams({view, search: $('search').value.trim()});
  if (append && nextCursor !== null) query.set('cursor', String(nextCursor));
  const result = await api('/submissions?' + query);
  if (generation !== listGeneration) return;
  if (!append) $('records').replaceChildren();
  const rows = result.submissions || [];
  for (const item of rows) {
    const row = element('article', undefined, 'record'), info = element('div');
    const button = element('button', item.title || 'Untitled material'); button.type = 'button';
    button.addEventListener('click', () => run(() => openRecord(item.id), 'status'));
    info.append(button);
    const course = courses.find(course => course.id === item.course_id);
    info.append(element('p', [item.course_id, course?.name, item.type, item.semester].filter(Boolean).join(' · ')));
    info.append(element('p', `Submitted ${date(item.created_at)}`));
    if (item.contributor_email) info.append(element('p', `Private contributor: ${item.contributor_email}`));
    row.append(info, element('span', statuses[item.status] || item.status, 'badge')); $('records').append(row);
  }
  nextCursor = result.next_cursor ?? null; $('load-more').hidden = nextCursor === null;
  if (!$('records').children.length) $('records').append(element('p', 'No records in this view.', 'notice'));
  message(rows.length ? `${$('records').children.length} record${$('records').children.length === 1 ? '' : 's'} loaded.` : 'No matching records.');
}
function closePreview() { if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; $('preview-image').removeAttribute('src'); $('image-preview').hidden = true; }
function paintDetail() {
  const item = detail.submission, terminal = TERMINAL.has(item.status);
  metadataDirty = false; closePreview();
  $('detail-heading').textContent = item.title;
  $('detail-state').textContent = statuses[item.status] || item.status;
  $('detail-reference').textContent = `Reference ${item.id} · Version ${item.version} · ${date(item.created_at)}`;
  $('contributor-info').replaceChildren();
  $('contributor-info').append(element('p', item.contributor_email ? `Private contributor: ${item.contributor_email}` : 'Private contributor identity is not retained for this record.'));
  if (item.reason) $('contributor-info').append(element('p', `Decision reason: ${item.reason}`));
  for (const [id, value] of Object.entries({'meta-title':item.title,'meta-course':item.course_id,'meta-type':item.type,'meta-semester':item.semester,'meta-credit':item.contributor})) $(id).value = value || '';
  $('file-list').replaceChildren();
  for (const revision of detail.revisions || []) {
    const row = element('div', undefined, 'file-row');
    const labels = [];
    if (revision.id === item.original_revision_id) labels.push('Original');
    if (revision.id === item.candidate_revision_id) labels.push('Selected candidate');
    if (revision.id === detail.published?.revision_id) labels.push('Current approved file');
    row.append(element('strong', revision.filename), element('p', [labels.join(' / '), revision.mime, bytes(revision.size), revision.status, date(revision.created_at), revision.created_by ? `Prepared by ${revision.created_by}` : ''].filter(Boolean).join(' · ')));
    if (revision.status === 'ready' && !terminal) {
      const actions = element('div', undefined, 'actions');
      const download = element('button', 'Download privately', 'text-button'); download.type = 'button';
      download.addEventListener('click', () => run(async () => { saveBlob(await fileBlob(revision), revision.filename); message('Private download prepared.'); })); actions.append(download);
      if (['image/png', 'image/jpeg'].includes(revision.mime)) {
        const preview = element('button', 'Preview image', 'text-button'); preview.type = 'button';
        preview.addEventListener('click', () => run(async () => {
          const blob = await fileBlob(revision); const bitmap = await decodeRaster(blob); bitmap.close();
          closePreview(); previewURL = URL.createObjectURL(blob); $('preview-image').src = previewURL; $('image-preview').hidden = false;
        }));
        const edit = element('button', 'Edit image', 'text-button'); edit.type = 'button';
        edit.addEventListener('click', () => run(() => openEditor(revision))); actions.append(preview, edit);
      }
      row.append(actions);
    }
    $('file-list').append(row);
  }
  if (!$('file-list').children.length) $('file-list').append(element('p', 'No retained file revisions.', 'help'));
  $('replacement-form').hidden = terminal;
  $('start-review').hidden = !['pending','unpublished'].includes(item.status);
  $('reject').hidden = !['pending','under_review'].includes(item.status);
  $('unpublish').hidden = item.status !== 'published';
  $('remove').hidden = terminal;
  $('approve').hidden = terminal;
  $('review-check-label').hidden = terminal;
  $('review-check').checked = false;
  $('candidate-summary').textContent = terminal ? 'This decision is final. Stored files are deleted through the cleanup process; only a minimal private history remains.' : `Approval publishes the selected candidate and the saved metadata above. ${item.status === 'published' ? 'The current public version remains available until you approve this candidate or unpublish it.' : 'No file is public while this record is in the private queue.'}`;
  $('public-state').hidden = !detail.published;
  if (detail.published) {
    const published = detail.published;
    $('public-description').textContent = published.status === 'published' ? `Current public version: ${published.title} · ${date(published.updated_at)}` : 'Public access is revoked. The former public download link must reject new requests.';
    $('availability').textContent = '';
    const url = safePublicURL(published.asset_url);
    $('public-link').hidden = !url; $('check-public').hidden = !url;
    if (url) $('public-link').href = url;
  }
  $('audit-list').replaceChildren();
  for (const event of detail.audit || []) {
    const entry = element('li', event.action.replaceAll('_',' '));
    entry.append(element('span', [date(event.created_at),event.actor,event.reason].filter(Boolean).join(' · '))); $('audit-list').append(entry);
  }
  const reload = element('button', 'Reload record', 'text-button'); reload.type = 'button'; reload.id = 'reload-record';
  reload.addEventListener('click', () => run(async () => {
    if (metadataDirty && !confirm('Reload and discard unsaved metadata changes?')) return;
    detail = await api(recordPath()); paintDetail(); message('Record reloaded.', 'detail-status');
  }));
  $('detail-reference').append(document.createTextNode(' · '), reload);
  paintEnabled();
}
function safePublicURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && /^\/download\/[a-zA-Z0-9-]+$/.test(url.pathname) && !url.username && !url.password && !url.hash && !url.search ? url.href : null; } catch { return null; }
}
async function openRecord(id) {
  detail = await api(`/submissions/${encodeURIComponent(id)}`); paintDetail(); message('', 'detail-status');
  $('detail-dialog').showModal(); $('detail-heading').focus();
}
async function mutate(action, fields = {}) {
  detail = await jsonPost(recordPath() + '/' + action, {version: detail.submission.version, ...fields});
  paintDetail(); await loadRecords();
}
function requireSavedMetadata() { if (metadataDirty) throw new Error('Save the candidate metadata before preparing a replacement or making a decision.'); }
function decisionDialog(action) {
  if (busy || !authorized) return;
  try { requireSavedMetadata(); } catch (error) { message(error.message,'detail-status'); return; }
  const descriptions = {
    reject: ['Reject submission', 'The material will not be published. Its original and edited files are queued for prompt deletion. This cannot be undone.'],
    unpublish: ['Unpublish for re-review', 'Public listings and existing download links stop working immediately. Files stay private for editing and later approval. The resource identity is preserved.'],
    remove: ['Permanently remove resource', 'Public access is revoked immediately. All associated original and edited files are queued for deletion, including any approved version. This cannot be undone. Previously downloaded copies cannot be recalled.']
  };
  decision = action; $('decision-title').textContent = descriptions[action][0]; $('decision-explanation').textContent = descriptions[action][1];
  $('confirm-decision').textContent = descriptions[action][0]; $('decision-reason').value = ''; $('decision-dialog').showModal(); $('decision-reason').focus();
}

$('metadata-form').addEventListener('input', () => { metadataDirty = true; $('review-check').checked = false; paintEnabled(); });
$('metadata-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  const fields = {title:$('meta-title').value,course_id:$('meta-course').value,type:$('meta-type').value,semester:$('meta-semester').value,contributor:$('meta-credit').value || null};
  await mutate('metadata', fields); message('Candidate metadata saved. Inspect and approve it before publication.', 'detail-status');
}); });
$('start-review').addEventListener('click', () => run(async () => { requireSavedMetadata(); await mutate('review'); message('Review started.', 'detail-status'); }));
$('approve').addEventListener('click', () => run(async () => {
  requireSavedMetadata(); if (!$('review-check').checked) throw new Error('Inspect and confirm the selected candidate first.');
  await mutate('approve', {revision_id:detail.submission.candidate_revision_id}); message('Selected candidate published. Anonymous downloads are enabled for this resource.', 'detail-status');
}));
for (const action of ['reject','unpublish','remove']) $(action).addEventListener('click', () => decisionDialog(action));
$('decision-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await mutate(decision,{reason:$('decision-reason').value}); $('decision-dialog').close();
  message(decision === 'unpublish' ? 'Public access revoked. The file is retained privately for re-review.' : 'Public access revoked. File cleanup is queued and will retry after failures.', 'detail-status');
}); });
$('cancel-decision').addEventListener('click', () => $('decision-dialog').close());
$('review-check').addEventListener('change', paintEnabled);
$('replacement-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  requireSavedMetadata(); const file = $('replacement-file').files[0];
  if (!file || file.size <= 0 || file.size > 24 * 1024 * 1024 || !/\.(pdf|docx|zip|png|jpg)$/i.test(file.name)) throw new Error('Choose a supported replacement no larger than 24 MiB.');
  await uploadRevision(file); $('replacement-form').reset(); message('Replacement saved privately and selected as the candidate. Preview it before approval.', 'detail-status');
}); });
async function uploadRevision(file) {
  const data = new FormData(); data.set('version', String(detail.submission.version)); data.set('file',file,file.name);
  detail = await api(recordPath() + '/revisions', {method:'POST',body:data}); paintDetail(); await loadRecords();
}
$('close-preview').addEventListener('click',closePreview);
function closeDetail() {
  if (busy) return;
  if (metadataDirty && !confirm('Close and discard unsaved metadata changes?')) return;
  closePreview(); $('detail-dialog').close(); detail = null; metadataDirty = false;
}
$('close-detail').addEventListener('click',closeDetail);
$('detail-dialog').addEventListener('cancel',event => { event.preventDefault(); closeDetail(); });
$('check-public').addEventListener('click', () => run(async () => {
  const url = safePublicURL(detail.published?.asset_url); if (!url) throw new Error('Public download link unavailable.');
  $('availability').textContent = 'Checking without administrator cookies…';
  const response = await fetch(url, {method:'HEAD',credentials:'omit',cache:'no-store',redirect:'error'});
  $('availability').textContent = response.ok ? 'Anonymous download is currently available.' : [404,410].includes(response.status) ? 'Anonymous download is unavailable.' : `Availability check returned ${response.status}; inspect the API configuration.`;
}));
for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => run(async () => {
  view = tab.dataset.view; for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed',String(other===tab));
  $('view-help').textContent = view === 'pending' ? 'Unpublished records remain private until approved again.' : view === 'published' ? 'Saved edits are private candidates until approved. Unpublish to fix a resource without keeping it publicly available.' : 'Minimal private decision records. Removed and rejected content cannot be restored.';
  await loadRecords();
},'status'));
$('search-form').addEventListener('submit',event => { event.preventDefault(); run(() => loadRecords(),'status'); });
$('refresh').addEventListener('click',() => run(() => loadRecords(),'status'));
$('load-more').addEventListener('click',() => run(() => loadRecords(true),'status'));
$('retry-cleanup').addEventListener('click',() => run(async () => { await jsonPost('/cleanup',{}); message('Cleanup retry completed. Failed deletions remain queued for later retry.'); },'status'));
async function session() {
  const result = await api('/session'); authorized = true; $('identity').textContent = result.email;
  for (const recovery of document.querySelectorAll('.session-recovery')) recovery.hidden = true; paintEnabled();
}
for (const retry of document.querySelectorAll('.retry-session')) retry.addEventListener('click',() => {
  const target = $('editor-dialog').open ? 'editor-status' : $('detail-dialog').open ? 'detail-status' : 'status';
  run(async () => { await session(); message('Session verified. Your draft is ready.', target); if (!detail) await loadRecords(); }, target);
});

// Image controls use output pixel coordinates. The fresh PNG is the only upload.
function cropFields() { const c=editorOptions.crop; for (const key of ['x','y','width','height']) $('crop-'+key).value=c[key]; }
function redraw() {
  if (!source) return;
  renderRaster(source,$('editor-canvas'),editorOptions);
  $('editor-inspected').checked=false; editorDirty=true;
  $('image-dimensions').textContent=`Final output: ${$('editor-canvas').width} × ${$('editor-canvas').height} pixels · ${editorOptions.redactions.length} opaque redaction${editorOptions.redactions.length===1?'':'s'}`;
  $('brightness-value').textContent=editorOptions.brightness+'%'; $('contrast-value').textContent=editorOptions.contrast+'%'; paintEnabled();
}
function resetGeometry() { const [width,height]=rotatedSize(source,editorOptions.rotation); editorOptions.crop={x:0,y:0,width,height}; editorOptions.redactions=[]; cropFields(); }
async function openEditor(revision) {
  requireSavedMetadata();
  const bitmap=await decodeRaster(await fileBlob(revision)); source?.close(); source=bitmap;
  editorOptions={rotation:0,brightness:100,contrast:100,grayscale:false,scan:false,redactions:[]}; resetGeometry();
  $('brightness').value='100'; $('contrast').value='100'; $('grayscale').checked=false; $('scan').checked=false;
  redraw(); editorDirty=false; message('Adjust the image, then inspect the final preview before saving.','editor-status'); $('editor-dialog').showModal();
}
for (const [id,delta] of [['rotate-left',270],['rotate-right',90]]) $(id).addEventListener('click',() => {
  if (!source || busy) return; editorOptions.rotation=(editorOptions.rotation+delta)%360; resetGeometry(); redraw(); message('Rotation applied. Crop and redactions were reset; inspect and reapply them.','editor-status');
});
$('reset-image').addEventListener('click',() => { if (!source||busy) return; editorOptions.rotation=0; editorOptions.brightness=100; editorOptions.contrast=100; editorOptions.grayscale=false; editorOptions.scan=false; resetGeometry(); $('brightness').value='100';$('contrast').value='100';$('grayscale').checked=false;$('scan').checked=false;redraw();message('All edits reset.','editor-status'); });
for (const key of ['brightness','contrast','grayscale','scan']) $(key).addEventListener('input',() => {
  if (!source||busy) return; editorOptions[key]=['grayscale','scan'].includes(key)?$(key).checked:Number($(key).value); redraw();
});
function rectangle(prefix) { return Object.fromEntries(['x','y','width','height'].map(key=>[key,Number($(prefix+'-'+key).value)])); }
$('apply-crop').addEventListener('click',() => {
  if (!source||busy) return;
  try { const [w,h]=rotatedSize(source,editorOptions.rotation); editorOptions.crop=checkedRectangle(rectangle('crop'),w,h); editorOptions.redactions=[]; redraw();message('Crop applied. Existing redactions were cleared; reapply and inspect them.','editor-status'); }
  catch(error){message(error.message,'editor-status');}
});
function addRedaction(rect) {
  checkedRectangle(rect,$('editor-canvas').width,$('editor-canvas').height); editorOptions.redactions.push(rect);redraw();message('Opaque redaction added to the output pixels.','editor-status');
}
$('add-redaction').addEventListener('click',() => { if(!source||busy)return;try{addRedaction(rectangle('redact'));}catch(error){message(error.message,'editor-status');} });
$('undo-redaction').addEventListener('click',() => { if(!source||busy)return;editorOptions.redactions.pop();redraw();message('Last redaction removed. Inspect the final preview.','editor-status'); });
function pointerPixel(event) { const c=$('editor-canvas'),r=c.getBoundingClientRect(); return {x:Math.max(0,Math.min(c.width-1,Math.floor((event.clientX-r.left)*c.width/r.width))),y:Math.max(0,Math.min(c.height-1,Math.floor((event.clientY-r.top)*c.height/r.height)))}; }
$('editor-canvas').addEventListener('pointerdown',event => { if(!source||busy)return;pointerStart=pointerPixel(event);event.currentTarget.setPointerCapture(event.pointerId); });
$('editor-canvas').addEventListener('pointerup',event => {
  if(!pointerStart||busy)return;const end=pointerPixel(event),start=pointerStart;pointerStart=null;
  addRedaction({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(start.x-end.x)+1,height:Math.abs(start.y-end.y)+1});
});
$('editor-canvas').addEventListener('pointercancel',()=>{pointerStart=null;});
$('editor-inspected').addEventListener('change',paintEnabled);
$('download-edited').addEventListener('click',() => run(async()=>{if(!source)throw new Error('Load an image first.');saveBlob(await exportPNG($('editor-canvas')),'cleaned-resource.png');message('Cleaned PNG exported locally. It has not been published.','editor-status');},'editor-status'));
$('save-edited').addEventListener('click',() => run(async()=>{
  if(!source||!$('editor-inspected').checked)throw new Error('Inspect and confirm the final preview first.');
  const file=new File([await exportPNG($('editor-canvas'))],'cleaned-resource.png',{type:'image/png'});await uploadRevision(file);editorDirty=false;closeEditor();message('Cleaned PNG saved as a private candidate. Inspect the saved revision before approving it.','detail-status');
},'editor-status'));
function closeEditor() { if(busy&&editorDirty)return; if(editorDirty&&!confirm('Discard unsaved image edits?'))return; $('editor-dialog').close();source?.close();source=null;editorDirty=false;pointerStart=null; }
$('close-editor').addEventListener('click',closeEditor);
$('editor-dialog').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
window.addEventListener('beforeunload',event=>{if(metadataDirty||editorDirty||busy){event.preventDefault();event.returnValue='';}});

await run(async()=>{
  await session();
  courses=(await api('/courses')).courses;
  for(const course of courses){const option=element('option',`${course.id} · ${course.name}`);option.value=course.id;$('meta-course').append(option);}
  await loadRecords();
},'status');
