// All catalog and service-provided text enters the document as text, never HTML.
export const $ = id => document.getElementById(id);
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function link(text, href, className = '') {
  const node = el('a', className, text.replace(/ ↗$/, ''));
  if (text.endsWith(' ↗')) node.append(arrowIcon());
  node.href = href;
  return node;
}
export function arrowIcon(direction = 'right') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('class', 'arrow-icon');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', direction === 'left' ? 'M16 10H4m5-5-5 5 5 5' : 'M4 10h12m-5-5 5 5-5 5');
  path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5');
  svg.append(path); return svg;
}
export function externalLink(text, href, className = '') {
  const node = link(text, href, className);
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  const hint = el('span', 'sr-only', ' (opens in a new tab)');
  node.append(hint);
  return node;
}
export function focusHeading(node) {
  node.tabIndex = -1;
  node.focus({ preventScroll: true });
}
