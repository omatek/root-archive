# root/archive

Independent student-led resource sharing: a static catalog, a Cloudflare Worker,
public-read R2 assets, and GitHub submission review. No database.

Start with [AGENTS.md](AGENTS.md), the [verified baseline](docs/audit.md), and
the [owner guide](docs/operations.md), and [moderation](docs/moderation.md).
Each submission proposes its catalog addition in one review PR. Automatic
cleanup covers proven branchless orphans; PR-associated files require owner
reviewed removal. Cleanup is off. The publication gate requires owner App/ruleset
setup and the [hosted spoof acceptance test](docs/publication-enforcement.md).
Pages also needs [submission preview exclusions](docs/pages-previews.md).

## Local checks

Use Node 24 and Python 3.11+. From this directory:

```sh
npm ci --prefix worker
node scripts/catalogs.mjs
node --test scripts/*.test.mjs
npm --prefix worker run check
python3 -m unittest discover -s analytics/tests -v
python3 -m unittest discover -s scripts/tests -v
```

Serve the static site with `python3 -m http.server 8000 --directory site`.
The frontend needs no build step. Dedicated courses use `/?course=<code>`; see
the [frontend architecture, screenshots and verification](docs/frontend/README.md).
Browser regressions run with `npm ci --ignore-scripts`,
`npx playwright install --with-deps chromium`, then `npm run test:frontend`.
Run the Worker with `npm --prefix worker run dev` only after configuring local
bindings; see the owner guide. Tests and dry-run builds do not deploy.

- [Backlog](docs/backlog.md): priorities, dependencies, acceptance criteria.
- [Cloud Computing](docs/academic/cloud-computing/README.md): architecture,
  inventory, safe measurement method, and report outline.
- [Security Analytics](analytics/README.md): offline synthetic generator,
  schema, validation, descriptive analysis, and reproducibility.

This repository is independent of educational institutions. Coursework does not
change project ownership or authorize collection of student data.
