import { CONFIG, TYPES } from './config.mjs';
import { cleanText, CONTROL_CHARS, httpsUrl, validateFile } from './catalog.mjs';
import { $, externalLink, focusHeading } from './dom.mjs';
import { createStudentAuth, createSecurityCheck } from './services.mjs';

export function createContribution(getCourses) {
  const dialog = $('contribution-dialog');
  const form = $('contribution-form');
  const auth = createStudentAuth();
  const security = createSecurityCheck();
  let selectedFile = null;
  let fileRevision = 0;
  let dirty = false;
  let busy = false;
  let completed = false;
  let returnFocus = null;

  function markDirty() { dirty = true; $('discard-draft').hidden = false; }
  function status(text, progress = false, focus = false) {
    $('submission-message').textContent = text;
    $('submission-status').hidden = false;
    $('submission-progress').hidden = !progress;
    if (focus) $('submission-status').focus();
  }
  function setBusy(value) {
    busy = value;
    $('contribution-fields').disabled = value;
    for (const id of ['submit-resource', 'close-contribution', 'save-close', 'discard-draft', 'signout']) $(id).disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  function error(field, text) {
    $(`${field}-error`).textContent = text;
    $(`${field}-error`).hidden = !text;
    $(`contribution-${field}`)?.setAttribute('aria-invalid', String(!!text));
  }
  function clearErrors() {
    for (const field of ['course', 'title', 'type', 'semester', 'contributor', 'file', 'turnstile']) error(field, '');
  }
  function populateCourses() {
    const select = $('contribution-course');
    const previous = select.value;
    const query = $('course-picker-search').value.trim().toLowerCase();
    const courses = getCourses();
    const matches = courses.filter(c => `${c.id} ${c.name}`.toLowerCase().includes(query));
    // Keep an already selected course in the list when narrowing the choices.
    const choices = courses.filter(c => c.id === previous || matches.includes(c));
    select.replaceChildren(new Option('Choose a course', ''));
    for (const course of choices) select.append(new Option(`${course.id} · ${course.name}`, course.id));
    select.value = previous;
    $('course-picker-status').textContent = courses.length
      ? query ? `${matches.length} matching ${matches.length === 1 ? 'course' : 'courses'}.${previous && !matches.some(c => c.id === previous) ? ' Your selected course is kept below.' : ''}` : ''
      : 'The course list is unavailable. Close this dialog and retry loading the archive.';
  }
  function resetDraft() {
    fileRevision++;
    form.reset(); selectedFile = null; dirty = false; completed = false;
    $('selected-file').textContent = ''; $('remove-file').hidden = true;
    $('discard-draft').hidden = true; $('submission-status').hidden = true;
    $('contribution-success').hidden = true; $('contribution-editor').hidden = false;
    clearErrors(); populateCourses();
  }
  function close() {
    if (busy) return;
    dialog.close();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else $('main-content').focus();
  }
  async function selectFile(file) {
    const revision = ++fileRevision;
    selectedFile = null; markDirty(); error('file', '');
    $('selected-file').textContent = 'Checking your file…';
    $('remove-file').hidden = false;
    const issue = await validateFile(file);
    if (revision !== fileRevision) return;
    if (issue) {
      error('file', issue); $('selected-file').textContent = '';
      $('contribution-file').value = ''; $('remove-file').hidden = true; return;
    }
    selectedFile = file;
    $('selected-file').textContent = `${file.name} · ${file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(file.size / 1024))} KiB`}`;
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || completed) return;
    clearErrors(); $('submission-status').hidden = true;
    const fields = Object.fromEntries(['course', 'title', 'type', 'semester', 'contributor'].map(name => [name, $(`contribution-${name}`).value]));
    const issues = [];
    function invalid(name, text) { error(name, text); issues.push(name); }
    if (!getCourses().some(course => course.id === fields.course)) invalid('course', 'Choose a course from the directory.');
    if (!TYPES.includes(fields.type)) invalid('type', 'Choose a resource type.');
    const title = cleanText(fields.title, 3, 120);
    const semester = cleanText(fields.semester, 4, 20);
    const contributor = fields.contributor.trim() ? cleanText(fields.contributor, 1, 40) : '';
    if (!title) invalid('title', 'Use 3–120 characters, without angle brackets or hidden control characters.');
    if (!semester) invalid('semester', 'Use 4–20 characters, such as Fall 2026, without angle brackets or hidden control characters.');
    if (contributor === null) invalid('contributor', 'Use up to 40 characters, without angle brackets or hidden control characters.');
    if (!selectedFile) invalid('file', 'Choose a valid file and wait for it to finish checking.');
    if (issues.length) {
      status('Please check the highlighted fields. Your draft has been kept.');
      form.querySelector('[aria-invalid="true"]').focus(); return;
    }
    const credential = auth.getToken();
    if (!credential) { auth.requireSignIn(); return; }
    const challenge = security.getToken();
    if (!challenge || challenge.length > 2048 || CONTROL_CHARS.test(challenge)) {
      error('turnstile', 'Complete the security check before submitting.');
      status('Please complete the security check. Your draft has been kept.', false, true); return;
    }
    // Lock before the asynchronous recheck: one request per explicit submission.
    setBusy(true);
    const file = selectedFile;
    const issue = await validateFile(file);
    if (issue) { setBusy(false); error('file', issue); $('contribution-file').focus(); return; }
    const data = new FormData();
    data.set('course_id', fields.course); data.set('title', title); data.set('type', fields.type);
    data.set('semester', semester);
    if (contributor) data.set('contributor', contributor);
    data.set('file', file, file.name); data.set('turnstile_token', challenge);
    status('Submitting your resource for review… Please keep this tab open.', true, true);
    try {
      const response = await fetch(CONFIG.submissionEndpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: data,
        signal: AbortSignal.timeout(120000)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true) {
        if (response.status === 401 || response.status === 403) {
          auth.clear(); status('Your account needs to be verified again. Sign in above; your draft is still here.', false, true);
        } else if (response.status === 413) {
          status('This upload is too large. Choose a file smaller than 24 MiB.', false, true);
        } else if (response.status === 429) {
          status('Too many requests. Wait a little before trying again. Your draft is still here.', false, true);
        } else if (response.status >= 500 || !payload) {
          status('We couldn’t confirm whether your submission was received. Your draft is still here. Avoid submitting it again immediately; the review request may already exist.', false, true);
        } else {
          status('Your resource wasn’t accepted. Check the details and file, complete the security check again, and retry. Your draft is still here.', false, true);
        }
        return;
      }
      const reviewUrl = httpsUrl(payload.pr_url);
      if (!reviewUrl || !/^https:\/\/github\.com\/omatek\/root-archive\/pull\/\d+$/.test(reviewUrl)) {
        status('The service reported success but did not return a valid review link. Avoid submitting again immediately; your material may already be awaiting review.', false, true); return;
      }
      completed = true; dirty = false; selectedFile = null; fileRevision++;
      form.reset(); $('contribution-editor').hidden = true; $('contribution-success').hidden = false;
      $('submission-reference').textContent = `${title} · ${fields.course}`;
      $('review-link').replaceChildren(externalLink('View review request on GitHub ↗', reviewUrl, 'text-button'));
      // Only the review link is shown. Pending asset URLs never enter the public UI.
      focusHeading($('success-heading'));
    } catch {
      status('The connection was interrupted, so we couldn’t confirm receipt. Your draft is still here. Avoid submitting again immediately; your material may already be awaiting review.', false, true);
    } finally {
      setBusy(false);
      if (!completed) security.reset();
    }
  }

  form.addEventListener('submit', submit);
  form.addEventListener('input', event => {
    if (event.target.id === 'course-picker-search') return;
    markDirty();
    const field = event.target.id.replace('contribution-', '');
    if ($(`${field}-error`)) error(field, '');
  });
  $('course-picker-search').addEventListener('input', populateCourses);
  $('contribution-file').addEventListener('change', event => {
    if (event.target.files[0]) selectFile(event.target.files[0]);
  });
  $('remove-file').addEventListener('click', () => {
    fileRevision++; selectedFile = null; $('contribution-file').value = '';
    $('selected-file').textContent = ''; $('remove-file').hidden = true; error('file', ''); markDirty();
  });
  for (const name of ['dragenter', 'dragover']) $('file-box').addEventListener(name, event => {
    event.preventDefault(); if (!busy) $('file-box').classList.add('drag-over');
  });
  $('file-box').addEventListener('dragleave', () => $('file-box').classList.remove('drag-over'));
  $('file-box').addEventListener('drop', event => {
    event.preventDefault(); $('file-box').classList.remove('drag-over');
    if (busy) return;
    if (event.dataTransfer.files.length !== 1) { error('file', 'Please choose one file at a time.'); return; }
    $('contribution-file').value = '';
    selectFile(event.dataTransfer.files[0]);
  });
  $('signout').addEventListener('click', () => { if (!busy) auth.clear(); });
  $('close-contribution').addEventListener('click', close);
  $('save-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // Backdrop clicks intentionally leave the draft dialog open; Escape/close are explicit.
  $('discard-draft').addEventListener('click', () => {
    if (!busy && window.confirm('Discard this draft and its selected file?')) { resetDraft(); security.reset(); $('contribution-course').focus(); }
  });
  $('contribute-another').addEventListener('click', () => { resetDraft(); security.reset(); $('contribution-course').focus(); });
  window.addEventListener('beforeunload', event => {
    if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
  });
  return { refreshCourses: populateCourses, open(courseId, trigger) {
    if (dialog.open) return;
    returnFocus = trigger;
    populateCourses();
    if (!dirty && !completed) {
      $('course-picker-search').value = ''; populateCourses();
      $('contribution-course').value = getCourses().some(c => c.id === courseId) ? courseId : '';
    } else if (dirty && courseId && $('contribution-course').value !== courseId) {
      status('Your unfinished contribution is still here. Finish it or discard the draft before starting one for another course.');
    }
    dialog.showModal();
    focusHeading(completed ? $('success-heading') : $('contribution-heading'));
    if (!completed) { auth.init(); security.reset(); }
  } };
}
