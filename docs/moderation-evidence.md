# Moderation implementation evidence — 2026-11-10

## Verified starting point and recovery

`origin/main` fetched at `859ce96240421d856c12334ea85aebd06fa54de8`, the merge
of PR #14. Initial clean `work` checkout was older:
`96f1be66745222c0a86040f8040542c437f084c1`. Implementation starts from fetched
main on `fix/complete-moderation`. Read AGENTS, audit, operations, existing tests,
and issues #4–#7 before edits. At that main: static catalog empty, 127 courses,
record-only submission PR creation, R2 rollback attempt, no publication gate or
scheduled cleanup. Live infrastructure and branch rules were not verified.

One bounded recovery check: fetched advertised refs and inspected local refs;
`git cat-file -t 535b2ce` failed, `git ls-remote --heads origin
fix/submission-moderation` returned no branch, and the GitHub commit API returned
422/no commit for `535b2ce`. No artifact recovered; the reported 45-test result
remains unverified. Reconstruction proceeded under this task's explicit
instruction, without accessing/recreating the historical workspace. Original
[baseline audit](audit.md) remains an historical record.

## Reproducible local verification

Node 24.22.1; tests use synthetic identities/content and mocked external hosts.
No production integration claim is made. Commands from the repository root:

| Command | Actual result |
| --- | --- |
| `npm ci --prefix worker` | Lockfile installation successful (local sandbox needed `--cache /tmp/root-archive-npm-cache`) |
| `npm --prefix worker run check` | TypeScript passed; Wrangler dry-run bundled; 50 Worker tests passed, zero skipped |
| `node --test scripts/*.test.mjs` | 20 repository tests passed |
| `python3 -m unittest discover -s scripts/tests -v` | 3 passed |
| `python3 -m unittest discover -s analytics/tests -v` | 5 passed |
| `node scripts/catalogs.mjs` | 127 unique courses, 0 production resources |
| `actionlint` v1.7.7 | All workflows passed; release archive SHA-256 checked; same pinned check added to CI |
| JSON parsing / frontend JavaScript parsing | All 7 tracked/new JSON files and 3 inline scripts parsed |
| Synthetic CI generation/analysis | 200 records generated and analyzed successfully |
| `npm audit --prefix worker` | 0 vulnerabilities |
| `git diff --check` | Passed |

Worker tests include five existing HTTP boundaries, signed RS256 JWT/claim/domain
rejections, Turnstile, file/size/metadata rejection, definite and ambiguous GitHub
failure/rollback, simultaneous submissions, and cleanup decisions/failures.
Real local workerd with Miniflare R2 exercises authenticated upload, immutable
object storage, anonymous public-host fixture reads, rejected cleanup, approved
preservation and conditional cursor writes. It intercepts every outbound host.

Repository tests use real temporary Git histories: conflicts, stale-base failure,
reconciliation preserving both resources, unsafe diffs/metadata/IDs/URLs,
legacy rejection, identity checks, and maintenance restrictions. The trusted CLI
is also run in a subprocess with mocked HTTP and local PR refs: it posts
pending/success/failure to exact head SHAs and never executes the PR's tampered
validator. These tests cannot establish hosted Actions status-source enforcement
or actual GitHub merge/Cloudflare permission semantics.

Cleanup tests cover never-created orphan grace, approval/receipt holds, API and
storage failures, cursor wrap/overlap, missing/uncertain provenance/association,
actual rename-closed PRs, reused branches, URL aliases and racing publication.
Automatic PR expiry and retirement are deliberately removed by the second review.

## P2 branch-rename regression correction

Before the correction, `renamed active submission is found by its stable PR
number, never treated as an orphan` failed: cleanup logged `cleanup_deleted`
with reason `orphan` for an eight-day-old asset despite its renamed open PR.
At commit `4c43f7f0`, the same test passed, with 73 total tests (52 Worker,
13 repository, 3 measurement and 5 analytics). That version was independently
reviewed again; the corrections below supersede its deletion/enforcement model.

That correction introduced stable conditional R2 PR associations; those remain.

## Second security review corrections

Five regressions failed against `4c43f7f0`: rename-closed deletion at the 12-hour
boundary; modification of an unrelated reused branch; authorization from stale
labels; label removal during validation; and revoked permission on an old rerun.
All five passed at `5b443a2b`, with **70 tests** (42 Worker, 20 repository, 3
measurement, 5 analytics), and no skipped tests in the full runs.

- GitHub ruleset `26518493` was inspected read-only: PR requirement, zero required
  reviews, deletion/non-fast-forward guards, no required checks. Legacy protection
  read returned 403. The current workflow/check enforcement is not live-verified.
- A distinct Checks-only App now emits exact-head checks, with response App-ID
  verification and no Actions-token fallback. The key is restricted to a main-only
  environment. Native App-ID binding or an organization required-workflow rule
  plus the spoof acceptance sequence are documented in
  [publication enforcement](publication-enforcement.md). Owner setup is pending.
- Live PR metadata and applicable collaborator permissions are re-read and policy
  revalidated before success. Subprocess tests exercise stale event/revocation
  cases and separate read/App-write credentials.
- Cleanup is intentionally narrower: PR-associated uploads and remaining branches
  are automatic holds. Only proven never-created, branchless seven-day orphans
  can be deleted. Cron makes no GitHub mutations, so it cannot modify a reused
  branch or infer rejection from automatic closure. Rejection/inactivity removal
  requires affirmative owner review and explicit per-key approval.

The hosted spoof acceptance test has **not** been executed; ordinary hosted CI
cannot establish App/environment/ruleset enforcement. No App, credential,
environment, branch protection, cleanup trigger or live PR was modified. Work is
exported only by committing/pushing the existing implementation branch.

## Third security review corrections

Three new regressions failed against `5b443a2b`: an identical-ETag replacement
was deleted; a failed association save returned 502 despite a created PR; and a
catalog larger than 1 MB could not be retrieved. All three now pass. The focused
command `node --test --test-name-pattern='regression:'
worker/tests/{cleanup,submission}.test.mjs` passes all five selected regressions,
including the earlier rename-closure and branch-reuse cases.

Current full total: **78 tests** (50 Worker, 20 repository, 3 measurement,
5 analytics), zero skipped. The verification table above records the current
run. Added tests also cover each upload identity field, the final age check,
inclusive 4 MiB retrieval/cancellation, invalid raw JSON/UTF-8 and unavailable or
mismatched PR confirmation. Real emulated R2 confirms identical bytes can have
equal ETags but distinct upload versions. No test claims atomic R2 deletion.

- R2 cleanup compares version/timestamp/size/ETag/provenance and rechecks age
  before deletion. Workers R2 has no conditional delete; the remaining
  HEAD/DELETE race and pause/drain requirement for restores are documented.
- Failed association persistence returns the PR URL only after a matching live
  PR is confirmed; durable intent protects the file and sanitized logs support
  repair. Uncertain creation or failed confirmation still cannot claim success.
- Commit-pinned raw Contents reads avoid GitHub's default 1 MB content omission;
  declared and streamed bytes are capped at 4 MiB, failing closed on errors.
- Existing Cloudflare check records confirm preview builds for legacy PRs
  #1–#3 and engineering PR #22. Anonymous URL probes could not establish public
  reachability: the workspace proxy denied the shell probe, and web retrieval
  failed. No complete Cloudflare inventory/configuration was available.
  [Pages guidance](pages-previews.md) records the exact exclusions, old-deployment
  audit and reproducible owner-run no-preview acceptance test. These live
  settings and tests are outstanding; no repository-only setting can enforce
  the project's Git preview exclusions.
- Post-validation revocation remains a human approval/hold boundary, with fresh
  validation/SHA required after revocation. No permission-monitoring service was
  added. Dedicated App/environment/required-check ruleset configuration and the
  hosted spoof test remain unconfigured/unverified owner steps.

## Complete changed-file inventory

| Files | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Preserve existing CI and add pinned/checksummed workflow lint |
| `.github/workflows/submission-policy.yml` | Protected-base publication policy with exact-head App check |
| `moderation.config.json` | Reviewed asset origin and backend PR identity |
| `scripts/catalog-policy.mjs`, `scripts/catalogs.mjs` | Separate pure shared validation from Node CLI |
| `scripts/moderation-policy.mjs` | Receipt, identity, metadata and append-only policy |
| `scripts/submission-git.mjs` | Safe inert Git blob/diff inspection |
| `scripts/validate-submission.mjs` | Trusted gate, identity/maintenance checks, live authorization and App checks |
| `scripts/reconcile-submission.mjs` | Preserve concurrent resources in a reviewed merge commit |
| `scripts/moderation.test.mjs`, `scripts/publication-authorization.test.mjs` | Adversarial diffs, Git histories, live authorization/revocation and distinct-App reporting |
| `scripts/fixtures/spoof-publication-check.yml` | Inert malicious workflow fixture for owner-approved staging |
| `worker/worker.ts` | Existing auth/validation plus immutable UUID upload, atomic catalog PR and safe rollback |
| `worker/github.ts` | Bounded GitHub API/Git-object client and authoritative reads |
| `worker/cleanup.ts` | Disabled-by-default scheduled cleanup, conservative orphan/approval holds and cursor |
| `worker/wrangler.jsonc` | Off mode and orphan retention defaults; no trigger activation |
| `worker/tsconfig.json` | Include shared pure policy and new modules |
| `worker/package.json`, `worker/package-lock.json` | Declare already-locked Miniflare version as direct test dependency |
| `worker/tests/http.test.mjs` | Preserve boundary suite with reviewed asset configuration |
| `worker/tests/fixtures.mjs` | Offline GitHub/R2 fixtures and synthetic contracts |
| `worker/tests/submission.test.mjs` | Signed-token submission, validation, publication simulation and failures |
| `worker/tests/cleanup.test.mjs` | Cleanup security, race, backlog and retry tests |
| `worker/tests/workerd.test.mjs` | Real local workerd/R2 lifecycle and public-read fixture |
| `site/index.html` | Waiting-for-review success text and PR link only |
| `AGENTS.md`, `README.md`, `docs/operations.md` | Update actual architecture/checks and human rollout boundaries |
| `docs/moderation.md`, `docs/moderation-evidence.md`, `docs/publication-enforcement.md`, `docs/pages-previews.md` | Implemented lifecycle, publication/preview operating and acceptance plans, and evidence |

Configuration requirements, retention conditions, concurrency procedure, legacy
resubmission, manual per-key reset/removal, monitoring, staging acceptance and
remaining risks are in [moderation](moderation.md). Required distinct App/environment/main protection, independent review and
owner-approved dry-run→active orphan cleanup remain manual. No existing student PR was modified, no object was deleted outside
local fixtures, and no merge, deployment or live configuration change occurred.
