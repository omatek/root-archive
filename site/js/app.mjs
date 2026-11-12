import { loadCatalog, filterCourses, readRoute, routeUrl } from './catalog.mjs';
import { TRACKS, TRACK_LABELS, TYPES, TYPE_HEADINGS } from './config.mjs';
import { $, el, link, externalLink, focusHeading, arrowIcon } from './dom.mjs';
import { createContribution } from './contribution.mjs';

let catalog = null;
let route = readRoute(location.href);
let loading = false;
const contribution = createContribution(() => catalog?.courses || []);
const urlFor = updates => routeUrl({ ...route, ...updates }, location.pathname);
function updateNavigationLinks() {
  document.querySelectorAll('[data-return], [data-directory]').forEach(anchor => { anchor.href = urlFor({ course: '', about: false }); });
  document.querySelectorAll('[data-about]').forEach(anchor => { anchor.href = urlFor({ course: '', about: true }); });
}
history.scrollRestoration = 'manual';
const positions = new Map();
let entryId = history.state?.entryId || crypto.randomUUID();
let restoring = false;
let restoreFrame = 0;
let positionTimer = 0;
history.replaceState({ ...history.state, entryId }, '', location.href);

const currentPosition = () => ({ scroll: scrollY, focus: document.activeElement?.id || '' });
function rememberPosition() {
  clearTimeout(positionTimer); positionTimer = 0;
  if (restoring) return;
  const position = currentPosition();
  positions.set(entryId, position);
  history.replaceState({ ...history.state, ...position }, '', location.href);
}
function restorePosition() {
  cancelAnimationFrame(restoreFrame);
  clearTimeout(positionTimer); positionTimer = 0;
  restoring = true;
  const saved = history.state;
  restoreFrame = requestAnimationFrame(() => {
    restoreFrame = 0;
    const target = saved?.focus ? $(saved.focus) : null;
    if (target?.matches('h1, h2, main')) focusHeading(target);
    else if (target) target.focus({ preventScroll: true });
    else focusHeading(route.course ? $('course-heading') || $('main-content') : route.about ? $('about-heading') : $('directory-heading'));
    window.scrollTo(0, saved?.scroll || 0);
    restoring = false;
    rememberPosition();
  });
}
function navigate(href, focus = '') {
  rememberPosition();
  restoring = true;
  const fromDirectory = !route.course && !route.about;
  entryId = crypto.randomUUID();
  history.pushState({ entryId, fromDirectory, scroll: 0, focus }, '', href);
  route = readRoute(location.href);
  render();
  restorePosition();
}
function returnToResults() {
  if (history.state?.fromDirectory) history.back();
  else navigate(urlFor({ course: '', about: false }));
}
function updateResults() {
  history.replaceState({ ...history.state, scroll: 0 }, '', urlFor({ course: '', about: false }));
  renderDirectory();
  updateNavigationLinks();
}

function renderDirectory() {
  $('course-search').value = route.query;
  $('has-materials').checked = route.hasMaterials;
  $('clear-search').hidden = !route.query;
  document.querySelectorAll('[data-track]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.track === route.track));
  });
  if (!catalog) return;
  const matches = filterCourses(catalog.courses, route.query, route.track, route.hasMaterials);
  $('result-count').textContent = `${matches.length} ${matches.length === 1 ? 'course' : 'courses'}${matches.length === catalog.courses.length ? '' : ` of ${catalog.courses.length}`}`;
  $('catalog-note').hidden = false;
  $('catalog-availability').textContent = catalog.resourceCount
    ? `${catalog.resourceCount} published ${catalog.resourceCount === 1 ? 'resource' : 'resources'}. All materials are free to open.`
    : 'The collection is just beginning. Courses with no resources are listed too.';
  const container = $('directory-results');
  container.replaceChildren();
  if (!matches.length) {
    const notice = el('div', 'notice');
    notice.append(el('h2', '', 'No matching courses.'), el('p', '', route.hasMaterials
      ? 'No courses with published materials match these filters. Turn off “Only courses with materials” to explore all matching courses, or change your search or track.'
      : 'Try a shorter name, a course code, or a different track.'));
    const reset = el('button', 'button button-secondary', 'Clear search and filters');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      route.query = ''; route.track = 'All'; route.hasMaterials = false; updateResults(); $('course-search').focus();
    });
    notice.append(reset); container.append(notice); return;
  }
  const table = el('table', 'course-table');
  const caption = el('caption', 'sr-only', 'Courses and published resource availability');
  const head = el('thead');
  const header = el('tr');
  ['Code', 'Course', 'Tracks', 'Resources'].forEach((name, index) => {
    const th = el('th', index === 2 ? 'course-tracks' : '', name); th.scope = 'col'; header.append(th);
  });
  head.append(header);
  const body = el('tbody');
  for (const course of matches) {
    const row = el('tr');
    row.append(el('td', 'course-code', course.id));
    const name = el('td', 'course-name');
    const anchor = link(course.name, urlFor({ course: course.id, about: false }));
    anchor.id = `course-${course.id}`; anchor.dataset.nav = '';
    anchor.append(el('span', 'sr-only', `, course ${course.id}`));
    name.append(anchor); row.append(name);
    row.append(el('td', 'course-tracks', TRACKS.filter(t => course.tracks.includes(t)).join(' · ')));
    const count = el('td');
    const amount = el('span', `resource-count${course.resources.length ? '' : ' is-empty'}`, course.resources.length ? String(course.resources.length) : 'None yet');
    amount.setAttribute('aria-label', `${course.resources.length} published resources`);
    count.append(amount); row.append(count); body.append(row);
  }
  table.append(caption, head, body); container.append(table);
}

function contributeButton(courseId, text = 'Contribute a resource', className = 'button') {
  const button = el('button', className, text.replace(/ ↗$/, ''));
  if (text.endsWith(' ↗')) button.append(arrowIcon());
  button.type = 'button'; button.dataset.contribute = courseId;
  return button;
}
function renderSteps(parent) {
  const steps = el('section', 'contribution-steps'); steps.setAttribute('aria-label', 'How contributing works');
  [
    ['Share what helped', 'Practice questions, summaries, notes and test banks can give the next student a starting point.'],
    ['Sign in to contribute', 'Contributions currently require an eligible student account. Reading and downloading need no account.'],
    ['Reviewed before publishing', 'A moderator checks every contribution before it joins the collection.']
  ].forEach(([title, text], index) => {
    const item = el('div'); const heading = el('h3');
    heading.append(el('span', 'step-number', `0${index + 1}`), document.createTextNode(title));
    item.append(heading, el('p', '', text)); steps.append(item);
  });
  parent.append(steps);
}
function renderResources(course, container, type = '') {
  container.replaceChildren();
  for (const category of TYPES) {
    const resources = course.resources.filter(resource => resource.type === category && (!type || type === category));
    if (!resources.length) continue;
    const group = el('section', 'resource-group');
    const heading = el('h3', '', `${TYPE_HEADINGS[category]} · ${resources.length}`);
    group.append(heading);
    const list = el('ul', 'resource-list');
    for (const resource of resources) {
      const row = el('li', 'resource-row');
      const info = el('div');
      info.append(el('h4', '', resource.title));
      info.append(el('p', 'resource-meta', [resource.type, resource.semester, resource.contributor && `Shared by ${resource.contributor}`].filter(Boolean).join(' · ')));
      const extension = /\.(pdf|docx|zip|png|jpg)$/i.exec(new URL(resource.asset_url).pathname)?.[1].toUpperCase();
      const open = externalLink(extension === 'ZIP' ? 'Open ZIP ↗' : `Open ${extension || 'file'} ↗`, resource.asset_url, 'resource-open');
      open.setAttribute('aria-label', `Open ${resource.title} (opens in a new tab)`);
      row.append(info, open); list.append(row);
    }
    group.append(list); container.append(group);
  }
}
function renderCourse() {
  const container = $('course-view'); container.replaceChildren();
  const back = link('← Back to results', urlFor({ course: '', about: false }), 'back-link');
  back.dataset.return = ''; container.append(back);
  if (!catalog) return;
  const course = catalog.byId.get(route.course);
  if (!course) {
    document.title = 'Course not found — root/archive';
    const notice = el('div', 'notice'); const title = el('h1', '', 'Course not found.'); title.id = 'course-heading';
    notice.append(title, el('p', '', 'This code isn’t in the current catalog. Return to the directory to find your course.'));
    container.append(notice); return;
  }
  document.title = `${course.name} (${course.id}) — root/archive`;
  const header = el('header', 'course-heading');
  header.append(el('p', 'eyebrow', `AUM · Course ${course.id}`));
  const title = el('h1', '', course.name); title.id = 'course-heading'; header.append(title);
  header.append(el('p', 'course-tracks', TRACKS.filter(t => course.tracks.includes(t)).map(t => TRACK_LABELS[t]).join(' · ')));
  container.append(header);
  const resourcesTitle = el('div', 'section-heading');
  resourcesTitle.append(el('h2', '', `Learning materials${course.resources.length ? ` · ${course.resources.length}` : ''}`));
  if (course.resources.length) resourcesTitle.append(contributeButton(course.id, 'Contribute a resource ↗', 'text-button'));
  container.append(resourcesTitle);
  if (!course.resources.length) {
    const empty = el('section', 'empty-course');
    empty.append(el('p', 'eyebrow', 'The collection starts here'), el('h2', '', 'No resources published yet.'));
    empty.append(el('p', '', 'Have practice questions, notes, or a helpful summary? Share them with the next student taking this course.'));
    empty.append(contributeButton(course.id));
    empty.append(el('p', 'small', 'An eligible student account is required to contribute. Every submission is reviewed.'));
    container.append(empty); renderSteps(container); return;
  }
  const resources = el('div');
  let selectedType = '';
  if (course.resources.length >= 12 && new Set(course.resources.map(r => r.type)).size > 1) {
    const filter = el('div', 'resource-filter');
    const label = el('label', '', 'Filter materials by type'); label.htmlFor = 'resource-type-filter';
    const select = el('select'); select.id = 'resource-type-filter'; select.append(new Option('All resource types', ''));
    for (const type of TYPES.filter(t => course.resources.some(r => r.type === t))) select.append(new Option(type, type));
    select.value = course.resources.some(r => r.type === history.state?.resourceType) ? history.state.resourceType : '';
    selectedType = select.value || '';
    const status = el('p', 'sr-only'); status.setAttribute('role', 'status');
    select.addEventListener('change', () => {
      history.replaceState({ ...history.state, resourceType: select.value }, '', location.href);
      renderResources(course, resources, select.value);
      status.textContent = `${course.resources.filter(r => !select.value || r.type === select.value).length} resources shown`;
    });
    filter.append(label, select, status); container.append(filter);
  }
  renderResources(course, resources, selectedType); container.append(resources);
}

function render() {
  $('directory-view').hidden = !!route.course || route.about;
  $('course-view').hidden = !route.course;
  $('about-view').hidden = !!route.course || !route.about;
  $('load-state').hidden = !loading || route.about;
  $('load-error').hidden = !!catalog || loading || route.about;
  document.title = route.about ? 'About root — root/archive' : 'root/archive — Student-built course materials';
  if (route.course) renderCourse();
  else if (!route.about) renderDirectory();
  updateNavigationLinks();
}
async function start() {
  if (loading) return;
  loading = true; render();
  try { catalog = await loadCatalog(); contribution.refreshCourses(); }
  catch { catalog = null; $('result-count').textContent = 'Catalog unavailable'; }
  finally { loading = false; render(); }
  // A direct link/reload can restore its history entry without stealing initial search focus.
  if (history.state?.scroll || history.state?.focus) restorePosition();
}

$('course-search').addEventListener('input', event => { route.query = event.target.value; updateResults(); });
$('has-materials').addEventListener('change', event => { route.hasMaterials = event.target.checked; updateResults(); });
$('clear-search').addEventListener('click', () => { route.query = ''; updateResults(); $('course-search').focus(); });
document.querySelectorAll('[data-track]').forEach(button => button.addEventListener('click', () => {
  route.track = button.dataset.track; updateResults();
}));
$('retry-load').addEventListener('click', start);
document.addEventListener('click', event => {
  const contribute = event.target.closest('[data-contribute]');
  if (contribute) { contribution.open(contribute.dataset.contribute, contribute); return; }
  const anchor = event.target.closest('a[data-nav], a[data-return]');
  if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank') return;
  if (new URL(anchor.href).origin !== location.origin) return;
  event.preventDefault();
  if (anchor.hasAttribute('data-return')) returnToResults();
  else navigate(anchor.href);
});
window.addEventListener('popstate', event => {
  // The URL/state already belongs to the destination, but the DOM still belongs
  // to the entry being left. Capture even a scroll whose event hasn't fired yet.
  if (!restoring) positions.set(entryId, currentPosition());
  restoring = true;
  entryId = event.state?.entryId || crypto.randomUUID();
  history.replaceState({ ...event.state, ...positions.get(entryId), entryId }, '', location.href);
  route = readRoute(location.href); render(); restorePosition();
});
window.addEventListener('scroll', () => {
  // Bound history writes during continuous scrolling. popstate captures the
  // final position synchronously even when this trailing save is still pending.
  if (!restoring && !positionTimer) positionTimer = setTimeout(rememberPosition, 500);
}, { passive: true });
document.addEventListener('focusin', rememberPosition);
window.addEventListener('pagehide', rememberPosition);
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || $('contribution-dialog').open) return;
  if (document.activeElement.matches('input, select, textarea, [contenteditable=true]')) return;
  event.preventDefault();
  if (route.course || route.about) navigate(urlFor({ course: '', about: false }), 'course-search');
  $('course-search').focus();
});
start();
