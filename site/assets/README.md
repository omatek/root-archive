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
