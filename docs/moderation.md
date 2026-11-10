# Submission moderation and cleanup

## Flow and storage

Google RS256 signature/issuer/audience/time/email verification and the exact
`std.aum.edu.jo` email + hosted domain remain mandatory. Explicit CORS, Turnstile,
25 MiB multipart limit, course/type/metadata/MIME/extension/signature checks run
before upload. New metadata also rejects HTML delimiters and bidi overrides.
The backend generates a full UUID v4 and conditionally creates
`assets/v1/<uuid>.<extension>` in R2; an existing key cannot be overwritten.
No email, Google identifier, token, or original filename enters the receipt.

R2 remains **public-read**, including pending uploads. Anyone knowing an asset
URL can download it directly, with no Google token, Worker proxy, GitHub lookup,
or signed URL. Anonymous users must have no write/delete access. These bucket
permissions require owner verification; source code does not establish them.

The Worker reads `main` at an exact Git commit, constructs one atomic Git tree
and commit, creates `submission/<uuid>`, and opens one moderation PR containing:

- One append to `site/resources.json`, preserving all existing entries in order.
- `submissions/<uuid>.json`: `{schema: 1, object_key, resource}`; `resource` is the
  exact public catalog entry with the existing frontend schema.

The PR includes an escaped metadata table and the public asset for moderator
inspection. The student UI shows “Submission received. Your material is
awaiting review.” and a PR link, with no immediate download link. Maintainers
review content and approve/merge the same PR. Pages' existing Git integration
publishes `site/` from `main`; no second publication PR or Actions deployment
exists. Closing an unmerged PR publishes nothing.

A definite GitHub failure attempts immediate R2 rollback. Failed rollback is
logged and the object retains recoverable provenance. Network failures, 5xx, or
malformed successful mutation responses are ambiguous: the object is retained
because GitHub may have created the PR. Cron reconciles it later. A student
retry can create another submission; UUIDs prevent replacement, not duplicates
of identical file bytes. Empty/dangling Git branches are harmless and may remain.

## Trusted publication gate

`.github/workflows/submission-policy.yml` uses `pull_request_target` with pinned
Actions and checks out only the protected event base SHA. It does **not** check
out, import, install, or execute PR code. Trusted scripts fetch PR Git objects
and read blobs/diffs as inert data. No production secrets are available. The
job's token has `contents: read`, `pull-requests: read`, `statuses: write` only.

The script posts the **Submission policy** status on the exact inspected PR
head, rather than relying on a target workflow's base-commit check association.
It verifies the fetched head and rechecks the open PR before reporting success.
A failed API/status operation does not grant approval. The base configuration
`moderation.config.json` pins the asset origin and Worker PR author. Worker
configuration must use that same asset origin; staging needs its own reviewed
configuration copy and credentials.

Submission branches (including old `submission-...` names) always get strict
validation. Other PRs touching catalog/receipts also get strict validation.
The gate requires a current base ancestor and exactly two regular, nonexecutable
files: catalog modification and one new UUID receipt. It validates the exact
resource schema, managed key/ID/URL binding, catalog membership, safe metadata,
no duplicate IDs/object references, exact receipt/catalog equality, and no
change/removal/reordering of existing entries. Workflow/script/Worker changes,
symlinks, extra fields and extra files fail. Only the configured backend author
in the same repository may submit managed proposals.

Engineering PRs that do not touch catalog/receipts use normal maintainer review.
A non-submission PR authored by a verified repository writer may use the
`catalog-maintenance` label **only to remove catalog entries**, preserving the
remaining entries and every receipt. This is the controlled removal exception;
it does not authorize new assets or receipt deletion. Ordinary CI still applies.

Owner setup after this workflow has landed through normal review:

1. Observe the actual **Submission policy** status on a canary PR, then require
   it on `main`, sourced from GitHub Actions. Also require **Repository checks**
   and **Worker checks**. Do not leave submission merging enabled during bootstrap.
2. Require branches to be up to date and at least one approving maintainer
   review. Dismiss stale approvals on new commits; require approval of the latest
   push. Block direct/force pushes, deletion, and bypasses on `main`, including
   for the backend identity. Do not grant the Worker main bypass permissions.
3. Restrict repository write access to trusted maintainers/backend. The status
   namespace alone is not protection against a malicious repository writer.
   Protect workflow/policy/config changes with normal security review.
4. Do not use merge queues with this version: there is no `merge_group` gate.

`submission_author` currently matches the existing `omatek` identity. GitHub
cannot count an author's own approval. Use another authorized reviewer, or
configure a dedicated bot/App identity and update the reviewed config before
launch. A human must verify the token's actual author; it was not inspected.

## Review and concurrent submissions

Inspect the file itself for suitability, privacy, copyright and malware; a
signature check is not a content review. Merge only green, current proposals
with the required review. Two PRs can initially append to the same old catalog;
after the first merges, the second is stale and must be reconciled. Never choose
one complete catalog side in a merge conflict or disable up-to-date protection.

Use a separate **trusted current-main checkout** to run the reconciler. In the
submission checkout, fetch `origin/main`, select the intended submission branch,
and ensure the working tree is clean. Then run, substituting actual paths:

```sh
node /trusted-main/scripts/reconcile-submission.mjs --repo /submission-checkout
# Prints a merge commit SHA, without moving refs or changing the working tree.
# In /submission-checkout, after inspecting that commit:
git merge --ff-only <printed-sha>
git push origin HEAD
```

The command validates the old proposal against its merge base, rejects arbitrary
edits/duplicate or retired submissions, and builds a merge commit from latest
main plus that one receipt/addition. Both resources survive. Required checks
and review must run again. If main advances again, repeat. It never force-pushes
or merges to main. The command expects the public repository's SHA-1 Git format.

## Cleanup decisions

`scheduled` is the only cleanup entry point. There is no HTTP deletion route.
The checked-in Worker sets `CLEANUP_MODE=off` and configures **no Cron trigger**.
A later owner-approved rollout may use `dry-run`, then `active`.

| Evidence | Decision |
| --- | --- |
| Current main catalog references the ID/key, or a receipt exists on main | Retain permanently |
| Original PR was merged, even if catalog later removed | Retain permanently |
| Missing/malformed provenance, legacy prefix, ambiguous/multiple PRs, unexpected state, unavailable verification | Retain and report/retry |
| Closed, unmerged PR | Eligible 12 hours after its actual latest close, if still unpublished |
| No PR exists for the generated branch | Eligible 7 days after R2 upload, if still unpublished |
| Open PR | Retain; may expire only after 30 days of genuine inactivity |

Rejection grace is configurable with `CLEANUP_REJECTED_HOURS` (1–168; default
12). Orphan grace uses `CLEANUP_ORPHAN_DAYS` (1–365; default 7). Invalid settings
retain objects. Provenance requires the v1 UUID key and backend metadata
`moderation_schema`, `submission_id`, canonical `created_at` close to actual R2
upload time. Legacy objects are not guessed into this contract.

Before expiring a pending PR, inspect PR update/head state, recent issue comments,
review submissions (including pending reviews), and inline review activity.
Incomplete activity pagination retains the file. Explain expiration in a comment,
recheck activity/head, close, verify closed/unmerged, then start the rejection
grace. A marked explanation can be reused after a failed close without counting
it as new human activity. Recent comments/reviews or changed head cancel expiry;
creation age alone is insufficient. Maintainers can reopen during the grace.
GitHub has no atomic “close only if no new activity” transaction: an event in the
last read/close interval may need maintainer reopening during that grace.

Before deleting, retire any submission branch by appending an intentionally
invalid `submissions/retired/<uuid>.json` marker commit using a non-force update.
If a rejected branch was deleted, recreate it at an invalid terminal head.
Confirm the ref, PR set and closed/unmerged state again. Reopening now cannot
merge its former green proposal: protected main requires checks on the current
head, which fails the allowed-path policy. Retired submissions must be resubmitted;
do not restore an earlier valid head or bypass the required checks.

After retirement, read main, catalog, courses and receipt **again** directly from
GitHub, with cache bypass. Any receipt protects the object, even if malformed;
URL aliases/query fragments referring to the managed key also retain it. Verify
unchanged R2 identity/provenance, then delete. Immutable generated keys and branch
retirement avoid racing legitimate publication; this relies on GitHub enforcing
current-head checks and maintainers preserving receipts. Publication and merged
state observed at any step cancel deletion. Never use the Pages catalog or a
compiled/cached catalog for destruction.

## Scheduling, limits and recovery

Proposed schedule after separate approval: `* * * * *` (once per minute, UTC).
One R2 key is scanned per invocation, with at most **32 GitHub requests** plus
at most five R2 operations (37 subrequests, below the Free limit of 50). Normal
rejected cleanup uses 19 GitHub calls in the workerd test. Activity pagination
allows at most four pages of 100 reviews; 100 recent issue comments or an
incomplete review history retain for manual attention rather than guessing.
Catalog files over 4 MiB also fail closed. This targets the existing small archive.

The durable R2 control object `moderation-control/scan-v1.json` stores the next
opaque list cursor and last scan time. Conditional writes compare its ETag;
overlapping runs may repeat work but cannot overwrite newer cursor progress.
Each object failure advances the scan, then retries on the next full sweep.
Deletion/ref retirement are idempotent; rate limits/outages never trigger a
blind delete. A failed cursor write repeats work. End-of-list wraps to the start,
so an approved or failing first key does not starve later keys. Control metadata
is public, contains no student information, and is outside the asset scan prefix.

At one-minute scheduling the maximum is **1,440 scanned keys/day**, including
approved/young objects; deletion throughput is no greater than that. A stable
N-key sweep takes about N minutes before retries/overlap. Rejection targets
12 hours plus one sweep (approximately 24 hours while N ≤ 720 and services are
healthy); expiry can require another sweep before rejection grace is revisited.
This is bounded best-effort cleanup, not a 24-hour SLA for unlimited backlog.

Monitor `cleanup_scan_advanced`, sweep wraps/last scan time, `cleanup_deleted`,
`cleanup_would_delete`, `cleanup_would_expire`, `cleanup_retry`,
`cleanup_scan_failed`, `cleanup_scan_overlap`, and `rollback_failed`. Logs contain
fixed outcomes, HTTP status codes and generated IDs, not tokens/content/emails.
Compare R2 v1 object count and age distribution with measured sweep duration.
Alert if sweeps exceed 12 hours, scan progress stops, retry/error counts grow,
or incoming objects approach scan capacity. Reduce intake or approve a tested
capacity change before backlog grows indefinitely. Increasing a batch without
reworking the subrequest budget is unsafe.

On an outage, retain data and repair upstream access; subsequent sweeps retry.
For corrupt/invalid cursor or stuck scan, stop Cron, inspect the sanitized error
and inventory, and after approval reset only the control object to `{schema:1}`;
never bulk-delete assets to repair a cursor. For deletion failures retry after
storage recovery. To stop cleanup, set mode off/disable the trigger using the
approved deployment procedure. Code rollback cannot restore a deleted object;
keep approved backups/versioned copies where required by the owner's policy.

## Configuration, legacy data and controlled removal

Worker GitHub credential: scope to this repository, Contents read/write (Git
objects/submission refs), Pull requests read/write (open/read/comment/close), and
inherent Metadata read. No administration, workflow, Actions, or main-bypass
permission. No production secret is needed by normal CI or the policy job.
Cloudflare retains the existing R2 binding/public-read host and Worker secrets
`GITHUB_TOKEN`, `TURNSTILE_SECRET`; existing OAuth client/origin bindings remain.
Verify asset origin/config, token identity/scopes, Google client/origins,
Turnstile hostnames, CORS, R2 write isolation and Pages main→`site/` integration.
Never configure lifecycle expiration over all `assets/`: it would delete approved
resources independently of this policy.

Legacy record-only PRs (#1–#3 and old `submission-...` branches) are intentionally
blocked with a resubmission instruction; they cannot silently publish. After
owner approval, close disposable tests and resubmit needed material through the
new flow. Leave legacy objects alone until the owner approves an explicit reset.
No migration or legacy automatic deletion exists.

For an intentionally removed published asset: open a separate maintainer catalog
removal PR with `catalog-maintenance`, retain its permanent receipt, review and
merge normally. After Pages publication and any chosen rollback window, stop
cleanup, inventory that exact key across current main/receipts and all open PRs,
verify no other catalog references, save a backup if desired, and obtain owner
approval for that explicit object deletion. Use the R2 dashboard/admin tools;
there is no public maintenance endpoint. Retain the receipt/audit trail afterward.
The same explicit per-key approved procedure resets disposable prelaunch data;
never delete a bucket/prefix wholesale or rewrite submission history.

## Staging acceptance and limitations

Run the commands in [the implementation evidence](moderation-evidence.md).
Local mocks/workerd tests do not establish real permissions, branch rules,
Cloudflare integration, or production correctness. Before launch, the owner must
approve an isolated staging repository/bucket/Worker/Pages setup and identity.
Then perform this acceptance sequence:

1. Verify forbidden origin/domain/expired token, failed Turnstile, bad signature
   and oversized file produce no stored object or PR. Sign in normally and
   submit; confirm the unchanged form/GIS/Turnstile design and waiting message.
2. Inspect exactly two PR files and the public pending asset. Verify anonymous
   GET works and anonymous write/delete fails. Confirm real branch protection
   blocks unreviewed, stale, tampered and retired proposals.
3. Submit twice before either merge; approve/merge the first, reconcile and
   reapprove the second. Verify both appear after the actual Pages deployment.
4. Reject a staging submission; begin dry-run Cron and inspect a full sweep.
   Explicitly approve active staging cleanup with shortened test-only retention
   or age fixtures. Verify rejection, orphan rollback failure, inactivity/comment
   cancellation, rate-limit/delete retry and overlap; prove approved assets survive.
5. Record tested SHA, check/status source, service deployment IDs, inventory,
   observed latency/quotas and rollback plan. Only then request production rollout
   approval; keep production cleanup off until its dry-run evidence is reviewed.

Accepted limits: pending files are public; upload content is not malware-scanned;
compromised backend/maintainer credentials are trusted writers; administrators
can defeat protection by bypassing checks/removing receipts. Availability outages,
large activity histories, malformed data and excess backlog delay deletion.
Student retries can duplicate content. Retired/dangling branches and permanent
receipts require occasional maintainer housekeeping. No live service, student PR,
object, bucket setting, secret, DNS, OAuth setting or production Cron was changed
or tested by this implementation task.
