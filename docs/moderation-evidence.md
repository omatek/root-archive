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
| `npm --prefix worker run check` | TypeScript passed; Wrangler dry-run bundled; 52 Worker tests passed, zero skipped |
| `node --test scripts/*.test.mjs` | 13 repository tests passed |
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

Cleanup tests cover grace periods, current catalog/permanent receipt/merged-PR
protection, activity and expiry retry, pagination/cursor wrap, repeated failures,
overlaps/non-force updates, missing/legacy provenance, object mutation, deleted
branches, URL aliases, rate limits and simulated merge/reopen/publication races.

## P2 branch-rename regression correction

Before the correction, `renamed active submission is found by its stable PR
number, never treated as an orphan` failed: cleanup logged `cleanup_deleted`
with reason `orphan` for an eight-day-old asset despite its renamed open PR.
The same test now passes. Fourteen additional tests bring the total to 73:
52 Worker, 13 repository, 3 measurement and 5 analytics tests.

The focused correction stores a conditional R2 association/creation-intent
record and reads linked PRs by number. It retains missing/ambiguous linkage and
failed/404 PR lookups, preserves definite-failure orphan cleanup, and retires a
rejected PR's actual current branch. Tests cover renamed/deleted branches,
approval preservation, multiple PRs, API failures, creation/link-write failure
windows, failed rollback followed by orphan cleanup, and real local workerd/R2.
Changed in this correction: `worker/github.ts`, `worker/worker.ts`,
`worker/cleanup.ts`, the four Worker test/fixture files, and these two moderation
documents. Cleanup remains off; no trigger, infrastructure or live data changed.

## Complete changed-file inventory

| Files | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Preserve existing CI and add pinned/checksummed workflow lint |
| `.github/workflows/submission-policy.yml` | Protected-base publication policy with exact-head status |
| `moderation.config.json` | Reviewed asset origin and backend PR identity |
| `scripts/catalog-policy.mjs`, `scripts/catalogs.mjs` | Separate pure shared validation from Node CLI |
| `scripts/moderation-policy.mjs` | Receipt, identity, metadata and append-only policy |
| `scripts/submission-git.mjs` | Safe inert Git blob/diff inspection |
| `scripts/validate-submission.mjs` | Trusted gate, identity/maintenance checks, head statuses |
| `scripts/reconcile-submission.mjs` | Preserve concurrent resources in a reviewed merge commit |
| `scripts/moderation.test.mjs` | Adversarial policy, actual Git conflicts and trusted CLI tests |
| `worker/worker.ts` | Existing auth/validation plus immutable UUID upload, atomic catalog PR and safe rollback |
| `worker/github.ts` | Bounded GitHub API/Git-object client and authoritative reads |
| `worker/cleanup.ts` | Disabled-by-default scheduled cleanup, activity/retirement/protection/cursor |
| `worker/wrangler.jsonc` | Off mode and retention defaults; no trigger activation |
| `worker/tsconfig.json` | Include shared pure policy and new modules |
| `worker/package.json`, `worker/package-lock.json` | Declare already-locked Miniflare version as direct test dependency |
| `worker/tests/http.test.mjs` | Preserve boundary suite with reviewed asset configuration |
| `worker/tests/fixtures.mjs` | Offline GitHub/R2 fixtures and synthetic contracts |
| `worker/tests/submission.test.mjs` | Signed-token submission, validation, publication simulation and failures |
| `worker/tests/cleanup.test.mjs` | Cleanup security, race, backlog and retry tests |
| `worker/tests/workerd.test.mjs` | Real local workerd/R2 lifecycle and public-read fixture |
| `site/index.html` | Waiting-for-review success text and PR link only |
| `AGENTS.md`, `README.md`, `docs/operations.md` | Update actual architecture/checks and human rollout boundaries |
| `docs/moderation.md`, `docs/moderation-evidence.md` | Implemented lifecycle, operating/acceptance plan and evidence |

Configuration requirements, retention conditions, concurrency procedure, legacy
resubmission, manual per-key reset/removal, monitoring, staging acceptance and
remaining risks are in [moderation](moderation.md). Required main protection,
identity/review separation and owner-approved dry-run→active Cron rollout remain
manual. No existing student PR was modified, no object was deleted outside
local fixtures, and no merge, deployment or live configuration change occurred.
