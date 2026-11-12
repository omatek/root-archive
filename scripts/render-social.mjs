// Development-only export; Pages serves the committed SVG and PNG directly.
// Reuse the actual masthead CSS, markup and fonts rather than redrawing its type.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const site = new URL('../site/', import.meta.url);
const html = await readFile(new URL('index.html', site), 'utf8');
let css = await readFile(new URL('styles.css', site), 'utf8');
for (const match of [...css.matchAll(/url\('\.\/(assets\/fonts\/[^']+)'\)/g)]) {
  const data = await readFile(new URL(match[1], site));
  css = css.replace(match[0], `url('data:font/woff2;base64,${data.toString('base64')}')`);
}
const fontFaces = css.match(/@font-face\{[^}]+\}/g).join('\n');
const header = html.match(/<header class="masthead">[\s\S]+?<\/header>/)[0];
const escapeXml = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const hex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('').toUpperCase();

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ['--no-sandbox']
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort()); // Embedded fonts only; no network.
  await page.setContent(`<style>${css}</style>${header}`);
  await page.evaluate(() => document.fonts.ready);
  const masthead = await page.evaluate(() => {
    const mark = document.querySelector('.wordmark');
    const start = mark.getBoundingClientRect().x;
    const canvas = document.createElement('canvas').getContext('2d');
    return {
      background: getComputedStyle(document.querySelector('.masthead')).backgroundColor,
      parts: [...mark.children].map(part => {
        const style = getComputedStyle(part);
        const family = style.fontFamily.split(',')[0];
        canvas.font = `${style.fontWeight} ${style.fontSize} ${family}`;
        canvas.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
        const ink = canvas.measureText(part.textContent);
        return { text: part.textContent, x: part.getBoundingClientRect().x - start,
          family, size: style.fontSize, weight: style.fontWeight,
          spacing: canvas.letterSpacing, color: style.color,
          left: ink.actualBoundingBoxLeft, right: ink.actualBoundingBoxRight,
          ascent: ink.actualBoundingBoxAscent, descent: ink.actualBoundingBoxDescent };
      })
    };
  });
  const left = Math.min(...masthead.parts.map(p => p.x - p.left));
  const right = Math.max(...masthead.parts.map(p => p.x + p.right));
  const top = -Math.max(...masthead.parts.map(p => p.ascent));
  const bottom = Math.max(...masthead.parts.map(p => p.descent));
  // Uniformly enlarge the desktop wordmark, leaving ample space on every edge.
  const scale = 4.8;
  const x = (1200 - (right - left) * scale) / 2 - left * scale;
  const y = (630 - (bottom - top) * scale) / 2 - top * scale;
  const text = masthead.parts.map(p => `    <text x="${p.x}" y="0" font-family="${escapeXml(p.family)}" font-size="${p.size}" font-weight="${p.weight}" letter-spacing="${p.spacing}" fill="${hex(p.color)}">${escapeXml(p.text)}</text>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">
  <title id="title">root/archive</title>
  <desc id="description">The website masthead: prominent cream root, a coral slash and smaller cream archive on plum-black.</desc>
  <!-- Generated from site/index.html and site/styles.css by scripts/render-social.mjs.
       Editable text; exact self-hosted font data embedded under the licenses in ../fonts/. -->
  <defs><style>
${fontFaces}
  </style></defs>
  <rect width="1200" height="630" fill="${hex(masthead.background)}"/>
  <g transform="translate(${x} ${y}) scale(${scale})">
${text}
  </g>
</svg>
`;
  const output = new URL('assets/social/', site);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('root-archive-og.svg', output), svg);
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<style>html,body{margin:0;width:1200px;height:630px;overflow:hidden}svg{display:block}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL('root-archive-og.png', output).pathname });
  console.log(JSON.stringify({ width: 1200, height: 630, scale,
    fonts: masthead.parts.map(({text, family, size, weight}) => ({text, family, size, weight})),
    svg: new URL('root-archive-og.svg', output).pathname,
    png: new URL('root-archive-og.png', output).pathname }));
} finally { await browser.close(); }
