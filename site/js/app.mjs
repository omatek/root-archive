import { loadCatalog, filterCourses, readRoute, routeUrl } from './catalog.mjs';
import { TRACKS, TRACK_LABELS, TYPES } from './config.mjs';
import { $, el, link, externalLink, focusHeading, arrowIcon } from './dom.mjs';
import { createContribution } from './contribution.mjs';

let catalog = null;
let route = readRoute(location.href);
let loading = false;
const contribution = createContribution(() => catalog?.courses || []);
const urlFor = updates => routeUrl({ ...route, ...updates }, location.pathname);
history.scrollRestoration = 'manual';

function rememberPosition() {
  history.replaceState({ ...history.state, scroll: scrollY, focus: document.activeElement?.id || '' }, '', location.href);
}
function restorePosition() {
  const saved = history.state;
  requestAnimationFrame(() => {
    const target = saved?.focus && $(saved.focus);
    if (target) target.focus({ preventScroll: true });
    else focusHeading(route.course ? $('course-heading') || $('main-content') : route.about ? $('about-heading') : $('directory-heading'));
    window.scrollTo(0, saved?.scroll || 0);
  });
}
function navigate(href) {
  rememberPosition();
  const fromDirectory = !route.course && !route.about;
  history.pushState({ fromDirectory, scroll: 0 }, '', href);
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
}

function renderDirectory() {
  $('course-search').value = route.query;
  $('clear-search').hidden = !route.query;
  document.querySelectorAll('[data-track]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.track === route.track));
  });
  if (!catalog) return;
  const matches = filterCourses(catalog.courses, route.query, route.track);
  $('result-count').textContent = `${matches.length} ${matches.length === 1 ? 'course' : 'courses'}${matches.length === catalog.courses.length ? '' : ` of ${catalog.courses.length}`}`;
  $('catalog-note').hidden = false;
  $('catalog-availability').textContent = catalog.resourceCount
    ? `${catalog.resourceCount} published ${catalog.resourceCount === 1 ? 'resource' : 'resources'}. All materials are free to open.`
    : 'The collection is just beginning. Courses with no resources are listed too.';
  const container = $('directory-results');
  container.replaceChildren();
  if (!matches.length) {
    const notice = el('div', 'notice');
    notice.append(el('h2', '', 'No matching courses.'), el('p', '', 'Try a shorter name, a course code, or a different track.'));
    const reset = el('button', 'button button-secondary', 'Clear search and filters');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      route.query = ''; route.track = 'All'; updateResults(); $('course-search').focus();
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
    anchor.append(arrowIcon()); name.append(anchor); row.append(name);
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
    ['Share what helped', 'Past papers, summaries and test banks can give the next student a starting point.'],
    ['Sign in to contribute', 'Use your AUM student account. Reading and downloading need no account.'],
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
    const heading = el('h3', '', `${category === 'Summary' ? 'Summaries' : category === 'Other' ? 'Other resources' : `${category}s`} · ${resources.length}`);
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
    empty.append(el('p', '', 'Have a past paper or a helpful summary? Share it with the next student taking this course.'));
    empty.append(contributeButton(course.id));
    empty.append(el('p', 'small', 'AUM student account required to contribute. Every submission is reviewed.'));
    container.append(empty); renderSteps(container); return;
  }
  const resources = el('div');
  if (course.resources.length >= 12 && new Set(course.resources.map(r => r.type)).size > 1) {
    const filter = el('div', 'resource-filter');
    const label = el('label', '', 'Filter materials by type'); label.htmlFor = 'resource-type-filter';
    const select = el('select'); select.id = 'resource-type-filter'; select.append(new Option('All resource types', ''));
    for (const type of TYPES.filter(t => course.resources.some(r => r.type === t))) select.append(new Option(type, type));
    const status = el('p', 'sr-only'); status.setAttribute('role', 'status');
    select.addEventListener('change', () => {
      renderResources(course, resources, select.value);
      status.textContent = `${course.resources.filter(r => !select.value || r.type === select.value).length} resources shown`;
    });
    filter.append(label, select, status); container.append(filter);
  }
  renderResources(course, resources); container.append(resources);
}

function render() {
  $('directory-view').hidden = !!route.course || route.about;
  $('course-view').hidden = !route.course;
  $('about-view').hidden = !!route.course || !route.about;
  $('load-state').hidden = !loading || route.about;
  $('load-error').hidden = !!catalog || loading || route.about;
  document.title = route.about ? 'About root — root/archive' : 'AUM course materials — root/archive';
  if (route.course) renderCourse();
  else if (!route.about) renderDirectory();
  document.querySelectorAll('[data-return]').forEach(anchor => { anchor.href = urlFor({ course: '', about: false }); });
}
async function start() {
  if (loading) return;
  loading = true; render();
  try { catalog = await loadCatalog(); }
  catch { catalog = null; $('result-count').textContent = 'Catalog unavailable'; }
  finally { loading = false; render(); }
  // A direct link/reload can restore its history entry without stealing initial search focus.
  if (history.state?.scroll || history.state?.focus) restorePosition();
}

$('course-search').addEventListener('input', event => { route.query = event.target.value; updateResults(); });
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
window.addEventListener('popstate', () => { route = readRoute(location.href); render(); restorePosition(); });
window.addEventListener('pagehide', rememberPosition);
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || $('contribution-dialog').open) return;
  if (document.activeElement.matches('input, select, textarea, [contenteditable=true]')) return;
  event.preventDefault();
  if (route.course || route.about) navigate(urlFor({ course: '', about: false }));
  $('course-search').focus();
});
start();
