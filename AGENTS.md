# Working on root/archive

## Confirmed architecture

- Private moderation replacement is implemented separately in `worker/moderation.ts`,
  `worker/wrangler.moderation.jsonc`, `worker/migrations/` and `admin/`. Read
  `docs/private-moderation.md` before changing this boundary. All revisions stay
  in a new private bucket; D1 publication state gates every anonymous download.
  Administrator assets and API share a Worker-first Access/allowlist gate.
  Unpublish retains a private file for review; permanent removal revokes and
  queues deletion. Do not restore public access using old catalogs or buckets.
- Isolated private moderation staging is deployed through Wrangler; production
  integration remains disabled. Version `bb9e96b3-e789-47b0-aa92-16168fe80db4`
  serves the approved admin/API-staging custom domains with staging D1/R2 only.
  Access app/policy/PIN/AUD were independently verified through the connector;
  the deployment token's Access read restriction is not a security failure.
  Both D1 migrations were already applied; do not reapply them. Group B now has
  one owned synthetic submission and one private PNG; inspect
  docs/staging-functional-manifest.json before writes or cleanup. Never reseed
  or overwrite that UUID/key blindly.
  Hosted custom/Access probes now reach staging: anonymous/forged administrator
  requests are denied and public-host admin paths return 404. The owner confirms
  presented certificate SAN coverage for both custom hosts, valid WE1 admin TLS,
  denial at both exact moderation alternate endpoints (statuses not captured),
  real Proton email-PIN login, portal/empty queue and session JSON. These are
  owner-observed hosted evidence, not Codex-executed probes. TLS/alternate-host
  gates are closed; do not require extra network grants or repeat these checks.
  Group A still needs independent Worker negative-JWT evidence and an actual
  expired/revoked-session denial. A genuine nonadmin case is conditional on
  availability under the approved plan; its absence is not a security failure.
  PR #27's evidence is consolidated into PR #26; preserve #27 open for the owner.
  The owner explicitly accepts deferring the unverified independent hosted JWT
  rejection and real expired/revoked-session cases for isolated synthetic-only
  functional acceptance. Group A is not fully passed; authorization is unchanged.
  Group B has started with n=1 only. Pending-file privacy/hash checks passed;
  owner-operated metadata edits/approval and executor-observed public catalog,
  anonymous PNG GET/HEAD/hash/safe filename/no-store checks passed. The fixture
  is currently published, awaiting owner unpublish for withdrawal verification.
  A separate review_started audit transition is not yet observed. Read
  `docs/staging-execution-results.md` and `docs/staging-deployment.md` before
  resuming. Legacy/production resources are unchanged; submissions and scheduled
  cleanup remain disabled. Public `CONFIG.privateModeration` is false.

- `site/`: static vanilla HTML/JS; `courses.json` is an array of `{id, name,
  tracks}`. `resources.json` is an array of `{id, course_id, type, title,
  semester, asset_url, contributor?, created_at}`. See `scripts/catalogs.mjs`.
- `worker/worker.ts`: TypeScript Worker; Google RS256 ID-token verification,
  exact `std.aum.edu.jo` email and hosted-domain authorization, explicit-origin
  CORS, Turnstile, bounded multipart and file-signature validation, R2 uploads.
- R2 resource storage is intentionally public-read. Unlisted files are public,
  not private. Writes/deletes belong to the backend. No database.
- New submissions open one `submission/<uuid>` PR that appends to the catalog
  and adds an immutable v1 receipt. Trusted base-branch validation governs
  publication; current-main reconciliation preserves concurrent additions.
- Cleanup automatically deletes only proven never-created, branchless orphans.
  Every PR-associated upload is held for owner-reviewed removal; Cron never
  modifies GitHub PRs/refs. It is off by default, with no trigger. Approval
  receipts are permanent. See `docs/moderation.md` before editing this boundary.
- Publication enforcement requires a distinct GitHub App and App-bound required
  check (or native organization required-workflow rule), not a GitHub Actions
  check name. See `docs/publication-enforcement.md`; owner setup is outstanding.
- Pages must exclude `submission/*` and legacy `submission-*` from previews;
  owner configuration and old-deployment audit are in `docs/pages-previews.md`.
- Historical `535b2ce` remains unavailable after a bounded recovery check;
  reconstruction was explicitly authorized. See `docs/moderation-evidence.md`.
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

`worker` checks run type checking, dry-run bundling, signed-token/lifecycle mocks,
cleanup tests and real local workerd/emulated R2. Repository tests exercise
trusted diff validation and concurrent Git histories. These are not live tests.
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
