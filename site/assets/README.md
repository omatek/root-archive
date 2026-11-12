# Frontend assets

`brand/source.svg` is the supplied, unmodified identity sheet. The six standalone
SVGs inline its exact hash path and underscore rectangle, with 8-unit padding
and a common `112 × 80` frame. No text, font dependency or external SVG reference
is used. `../favicon.svg` centers the same geometry in a square; its strokes are
not redrawn. Only root and archive variants are used in the archive interface.
Use meaningful `alt` text for standalone marks, or `alt=""` beside equivalent text.

Fonts are self-hosted Latin WOFF2 subsets from Fontsource 5.3.0:
Barlow Semi Condensed (600/700) and Atkinson Hyperlegible Next (variable 200–800).
Their SIL Open Font Licenses are included in `fonts/`. These are static assets,
not runtime npm dependencies. System fallbacks cover other scripts and blocked
font loading. No third-party font or CSS request is needed to browse the archive.

## Social sharing

`social/root-archive-og.svg` is the editable 1200 × 630 social card. It reuses
the desktop masthead's exact text, fonts, weights (700/600/450), 42:36:23 size
ratio, baseline, tracking and 10px gaps, uniformly enlarged 4.8× and centered
with generous margins. Its only colors are plum-black `#262229`, cream
`#F7F8F2` and coral `#EE8B73`. The three existing WOFF2 files are embedded as
data URLs, under the licenses in `fonts/`, so editing/rendering the SVG needs no
external font or stylesheet. Text remains editable; it is not a generated logo.

`social/root-archive-og.png` is the opaque 1200 × 630 raster used by Open Graph
and Twitter metadata. Chromium renders it from the SVG after embedded fonts
finish loading, with all network requests blocked. It is self-contained.
Regenerate both committed files from the repository root using existing dev
dependencies (no Pages build step):

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/render-social.mjs
# Or omit the variable when using Playwright's installed Chromium.
```

The export was visually compared with the actual masthead, including at 360px
card width. Browser regression checks verify the brand-first directory title,
static metadata on course URLs with JavaScript disabled, and PNG decoding,
dimensions and background without site CSS. All course links deliberately share
the same site identity: static Pages does not generate per-course previews.
Social-service caches may require refreshing after a later owner-approved
deployment; no live scraper result or deployment is claimed here.

Verification (2026-11-12): `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
npm run test:frontend` passed all 16 browser tests; `node --test
scripts/*.test.mjs` passed all 27 repository tests; `node scripts/catalogs.mjs`
and `git diff --check` passed. HTML5 parsing (temporary html5lib 1.1, strict
mode) reported zero errors, and all five canonical/social URLs use the intended
HTTPS host. PNG decoding and SVG XML/font loading were checked independently;
the artwork has at least 188px horizontal and 246px vertical edge space.
Repeating the export produced identical SHA-256 hashes for both files.

![root/archive social preview](social/root-archive-og.png)
