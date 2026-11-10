# Working on root/archive

## Confirmed architecture

- `site/`: static vanilla HTML/JS; `courses.json` is an array of `{id, name,
  tracks}`. `resources.json` is an array of `{id, course_id, type, title,
  semester, asset_url, contributor?, created_at}`. See `scripts/catalogs.mjs`.
- `worker/worker.ts`: TypeScript Worker; Google RS256 ID-token verification,
  exact `std.aum.edu.jo` email and hosted-domain authorization, explicit-origin
  CORS, Turnstile, bounded multipart and file-signature validation, R2 uploads.
- R2 resource storage is intentionally public-read. Unlisted files are public,
  not private. Writes/deletes belong to the backend. No database.
- Current submissions create `submissions/*.json` on a GitHub branch and open
  a PR. They do **not** update the public catalog. GitHub failure attempts R2
  rollback, but deletion failure is swallowed. No scheduled cleanup exists.
- Reported moderation commit `535b2ce` could not be recovered. Treat recovery
  as P0; do not rebuild or edit moderation incidentally. See `docs/audit.md`.
- Production configuration/deployment is unverified. `analytics/` is synthetic
  and offline; it is not production telemetry.

## Development

Inspect code, Git state, and open issues/PRs before editing. Preserve unrelated
uncommitted work. Use focused patches, vanilla JS/TS, existing contracts, and
few dependencies. Avoid speculative architecture changes. Never commit secrets,
student information, real traffic, or raw authentication material. Clearly
distinguish observations, assumptions, and simulated results.

Use Node 24 and Python 3.11+ from the repository root:

```sh
npm ci --prefix worker
node scripts/catalogs.mjs
node --test scripts/*.test.mjs
npm --prefix worker run check
python3 -m unittest discover -s analytics/tests -v
python3 -m unittest discover -s scripts/tests -v
```

`worker` checks run type checking, dry-run bundling, and HTTP boundary tests.
These do not establish full JWT, R2, GitHub, publication, or cleanup coverage.
Add meaningful tests for behavior changed and update relevant docs. No ordinary
PR check needs production credentials. Never weaken authentication, validation,
storage authorization, or workflow trust boundaries to make a test pass.

## Git and human control

Use a separate feature branch/worktree per independent task. No direct pushes
to production branches, force pushes, automatic merges, security-check bypass,
or destructive operations. No deployments, production simulations, live
configuration changes, or real-data collection without explicit human approval.
Keep independent work reviewable. Commit completed work and push a feature
branch with a draft PR when access permits; otherwise provide a verified Git
bundle/patch outside the temporary workspace.

Finish by reporting files and purpose, exact test commands/results, outstanding
issues, security implications, manual actions, full commit SHA, PR URL, and
durable export status. Never claim a local test proves production behavior.
