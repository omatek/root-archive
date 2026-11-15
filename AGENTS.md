# Working on root/archive

## Confirmed architecture

- Current acceptance priority (15 November): real contributor integration first.
  Read `docs/student-staging-acceptance.md`. The separate student frontend and
  staging configuration and initially paused deployment are approved from
  e9f72a4; Google-configured paused setup is deployed from 40f6c5d. The owner now
  approves the single-PDF supervised staging acceptance with at most 60 minutes
  of upload enablement and a server-enforced automatic cutoff. Verify the actual
  allowlisted Google session and storage preflight before enabling. Re-pause
  immediately after the one accepted upload or on any safety issue. Cleanup
  requires separate confirmation of the exact NEW submission/revision/key;
  present identifiers first. Preserve unrelated fixtures and all audits. Do not run
  fixture 4 or n=5..205 pagination as prerequisites. Preserve all older evidence.
  The new staging account allowlist is fail-closed when empty/missing; provision
  only owner-approved test accounts as a secret. Hosted independent Worker JWT
  checks remain unverified with an unresolved pilot risk-acceptance decision.
  Deterministic fixture 4 concurrency and focused pagination are deferred to
  merge/launch acceptance. The artificial 200 ms interruption test is no longer
  an acceptance gate; preserve historical evidence without requiring execution.

- Private moderation replacement is implemented separately in `worker/moderation.ts`,
  `worker/wrangler.moderation.jsonc`, `worker/migrations/` and `admin/`. Read
  `docs/private-moderation.md` before changing this boundary. All revisions stay
  in a new private bucket; D1 publication state gates every anonymous download.
  Administrator assets and API share a Worker-first Access/allowlist gate.
  Unpublish retains a private file for review; permanent removal revokes and
  queues deletion. Do not restore public access using old catalogs or buckets.
- Isolated private moderation staging is deployed through Wrangler; production
  integration remains disabled. Current window-enabled backend version is
  `d56561f7-20a2-48db-a280-8ca2721abe41`; student frontend version is
  `30f908f3-9faa-4799-b566-c46b3cc8da41`, on archive-staging.rootamman.com.
  The backend serves approved admin/API-staging domains with staging D1/R2 only.
  The separate Turnstile widget/secret and owner-provided Google Web client are
  configured. The owner clarified that no student had actually been added to the
  earlier secret and explicitly authorized the agent to set one test account.
  That single account is now set as a protected secret; its address is excluded
  from Git/evidence. Owner HTTPS/top notice confirmation stands.
  The owner has now confirmed actual student account verification and security
  widget completion in the real frontend. This closes the eligible-account/
  allowlist check. Owner reports the paused-submit and ineligible denials; fresh
  reads show zero storage changes. Server Siteverify awaits upload testing. The
  original 50-minute window was deployed before a usage-limit interruption:
  2026-11-15T17:38:39.447Z through 18:28:39.447Z. DO NOT restart or extend it.
  Submissions flag is currently true but the Worker automatically denies new
  intents at cutoff; explicitly re-pause immediately after one accepted upload,
  any safety issue or on resume after expiry. Cron remains off. See
  docs/student-staging-window-open.json and docs/student-staging-eligible-auth.json and
  docs/student-staging-live-manifest.json and docs/student-staging-live-preflight.json.
  Live run is authorized; next are missing/invalid Turnstile UI denials and the
  single PDF. No new submission exists at the 18:08:25Z reconciliation. Do not
  replay submissions or ask for live approval again. Cleanup still needs exact-ID confirmation.
  The original synthetic acceptance below used version bb9e96b3.
  Access app/policy/PIN/AUD were independently verified through the connector;
  the deployment token's Access read restriction is not a security failure.
  Both D1 migrations were already applied; do not reapply them. Group B now has
  three owned synthetic submissions: n=1 removed and n=2 rejected, both R2 files
  deleted with audit/tombstones preserved; n=3 reconciled without reseeding and
  passed editing, replacement publication, same-ID republication and a real
  two-tab stale-write check, then permanent removal at version 7. All four
  campaign revisions are deleted and staging R2 is empty; audit/tombstones remain.
  Inspect docs/staging-functional-manifest.json before writes or cleanup. Never reseed
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
  PR #27's evidence is consolidated into PR #26. Current read-only GitHub
  metadata shows #27 closed/unmerged since 14 November 11:52:52Z; do not change
  its state. This acceptance continuation did not close, merge or reopen it.
  The owner explicitly accepts deferring the unverified independent hosted JWT
  rejection and real expired/revoked-session cases for isolated synthetic-only
  functional acceptance. Group A is not fully passed; authorization is unchanged.
  Group B has started with n=1..3 only. Pending-file privacy/hash checks passed;
  owner-operated metadata edits/approval and executor-observed public catalog,
  anonymous PNG GET/HEAD/hash/safe filename/no-store checks passed. The fixture
  passed withdrawal denial/private retention and permanent removal/physical R2
  cleanup. The n=2 Start review/rejection and physical deletion pass. The side
  browser is visible in context, but browser control tools are not exposed in
  this execution session; no separate browser shares its authenticated session.
  Image rotation/redaction/replacement, stale-write protection, replacement
  approval/public hash, original cleanup, same-ID republication and final n=3
  removal pass. Full pagination, overlapping operation races and interrupted-
  request recovery remain open. The owner requested a reviewable browser client
  but explicitly prohibited execution/new seeding until independent review and
  approval. Read docs/staging-browser-client.md. The client is prepared only;
  independent review is pending. Keep n=4..205 unseeded for now. Read
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
