# Submission moderation and conservative cleanup

## Submission and publication

Google RS256 signature/issuer/audience/time/email verification and the exact
`std.aum.edu.jo` email + hosted domain remain mandatory. Explicit CORS, Turnstile,
25 MiB multipart limit, course/type/metadata/MIME/extension/signature checks run
before upload. New metadata rejects HTML delimiters and bidi overrides. The
backend generates a full UUID v4 and conditionally creates
`assets/v1/<uuid>.<extension>`; an existing object cannot be overwritten.

R2 remains public-read, including pending uploads. Anyone knowing an asset URL
can download it directly without Google, a Worker proxy, GitHub lookups or signed
URLs. Public access must never allow writes/deletes. Bucket permissions and the
existing Pages main→`site/` Git integration require owner verification.

The Worker reads main at an exact commit and creates one atomic Git commit/PR on
`submission/<uuid>` containing exactly:

- An append to `site/resources.json`, preserving existing entries/order.
- `submissions/<uuid>.json`: `{schema:1, object_key, resource}`, with the exact
  public catalog entry. No email, Google identifier or token is recorded.

A moderator reviews the actual content and approves/merges this PR; Pages then
publishes the catalog. No second publication PR exists. Rejection publishes
nothing. The existing form/GIS/Turnstile design is preserved. Success shows
“Submission received. Your material is awaiting review.” and a PR link only.

`moderation-control/submissions/<uuid>.json` binds repository/UUID/key to a stable
PR number. Conditional R2 writes record `not-created` before GitHub work,
`creating` before the PR POST, and `linked` after success. A definite rejected
POST restores `not-created`; ambiguous responses or failed link persistence keep
`creating`. Definite submission failure attempts rollback; failed rollback is
logged. A known-created PR's file is never rolled back on link persistence failure.
No database or new service is used. Control records are public nonstudent data.

## Trusted validation and enforcement

Read [publication enforcement](publication-enforcement.md) before rollout. A
required name sourced from **GitHub Actions is insufficient**: fork workflows
share that App identity. The implemented reporter uses a **distinct GitHub App**,
a main-only secret environment, and a native required check bound to that App's
integration ID. An organization/enterprise required-workflow ruleset is the
preferred alternative when available. No live configuration was changed and
hosted spoof enforcement has not been tested. Launch is blocked until owner
configuration and the documented staging acceptance test succeed.

The target workflow checks out only the protected base and reads head blobs/diffs
as inert data. No head checkout, import, installation or privileged execution
occurs. Normal CI executes PR code with read-only permissions and no App key.
The gate checks current-base ancestry, exactly two regular allowed files, exact
schemas/receipt equality, safe metadata, generated UUID/key/managed URL binding,
no duplicates, and no mutation/removal/reordering of existing catalog entries.

Submission branches always receive strict validation. Other catalog/receipt PRs
also do. Engineering PRs use normal maintainer review. The limited maintenance
exception requires the **current** `catalog-maintenance` label and a current
repository writer; it permits only catalog removals, preserving all receipts
and remaining entries. Live author/head/base/labels and applicable permissions
are read again before success; changed authorization fails. Old workflow event
labels are never authorization. See enforcement docs for commit-scoped revocation
limits and the need to hold merges while a fresh result is unavailable.

The backend author remains configured in `moderation.config.json` (`omatek` at
present). An author cannot approve their own PR; use another maintainer or a
separately configured bot. Require independent approval/current branches and no
main bypasses. This implementation does not support merge queues.

## Concurrent submissions

After PR A merges, PR B's old full-file catalog proposal is stale. Do not choose
one side of the JSON conflict or weaken protection. From a separate trusted
current-main checkout, run the reconciler against a clean submission checkout
whose `origin/main` has been fetched:

```sh
node /trusted-main/scripts/reconcile-submission.mjs --repo /submission-checkout
# Inspect the printed merge commit, then in the submission checkout:
git merge --ff-only <printed-sha>
git push origin HEAD
```

The command validates the old proposal, builds from latest main plus that one
addition and preserves both resources. It moves no ref until the maintainer
accepts it. Checks and independent review must run again. Repeat if main advances.
It uses SHA-1 Git object IDs and rejects extra edits or duplicate resources.

## Conservative automatic deletion

The security review replaces inferred rejection and branch retirement with a
smaller model. **Any associated PR is a permanent automatic-cleanup hold**, whether
open, closed, merged, old, renamed, or apparently inactive. Cron does not comment,
expire, close or modify PRs and never creates/updates/deletes repository refs.
It cannot distinguish intentional rejection from GitHub's automatic closure on
head rename using closed state alone. It also cannot safely retire a name that
may have been reused. Those actions have therefore been removed.

Tradeoff: rejected/abandoned submissions and failed uploads with remaining
branches require explicit owner-reviewed per-key cleanup. The former automatic
12-hour rejection and 30-day expiry behavior is withdrawn. No label/comment or
negative lookup silently grants deletion permission. Maintainers can still close
inactive submissions manually after reviewing actual comments/reviews, without
that closure authorizing file deletion.

Only a proven never-created orphan can be automatically deleted:

1. V1 UUID key and backend provenance match canonical creation time and actual
   R2 upload time; missing/malformed/legacy provenance retains.
2. Fresh authoritative main/catalog/course/receipt reads show no approval.
   Any receipt or catalog ID/key/URL alias protects the object permanently.
3. A valid R2 association explicitly says `not-created` for this repository,
   UUID and key; `creating`, missing or malformed state retains. A contradictory
   PR, multiple PRs, unknown status or API error retains. Linked PRs are fetched
   by number, regardless of branch/title/body changes; a 404 never means orphan.
4. R2 upload age is at least `CLEANUP_ORPHAN_DAYS` (default 7, allowed 1–365).
5. The original submission branch does not exist. Any remaining/reused/diverged
   branch is a hold, regardless of its contents. Cleanup performs no branch writes.
6. Association, PR/branch absence and main approval are checked again, and the
   R2 object identity/provenance is unchanged immediately before deletion.

This handles failed rollback before branch creation. A definite failed PR POST
may leave a branch, so its object is intentionally held for owner cleanup.
No object with an actual/uncertain PR creation can become an orphan through a
rename, closure, elapsed grace period, or lookup failure. Do not manually create
replacement PRs for failed uploads without restoring a verified association;
resubmit through the supported flow instead.

`scheduled` is the only cleanup entry point. There is no HTTP deletion endpoint.
Checked-in mode is `off`, with no Cron trigger configured. The obsolete
`CLEANUP_REJECTED_HOURS` setting has been removed.

## Limits, monitoring and recovery

After separate approval, a proposed once-per-minute UTC Cron scans one asset key
per invocation. GitHub is bounded to 32 calls; at most seven R2 operations give a
39-subrequest ceiling under the Free limit of 50. Maximum scan/deletion throughput
is 1,440 keys/day, including retained assets. A stable N-key sweep takes about N
minutes plus failures/overlap. There is no automatic rejected-upload deletion SLA.

`moderation-control/scan-v1.json` persists an opaque list cursor and last scan
time. ETag compare-and-swap prevents overlapping writers from overwriting newer
progress. Object failures advance the cursor and retry next sweep; end-of-list
wraps, so retained/failing first keys do not starve later keys. Delete and retry
are idempotent. Catalog files over 4 MiB and incomplete PR listings fail closed.
Control records are outside the asset scan and remain as small audit markers.

Monitor `cleanup_scan_advanced`/wrap/last scan time, `cleanup_scan_overlap`,
`cleanup_retry`, `cleanup_scan_failed`, `cleanup_retain_submission`,
`cleanup_retain_branch`, `cleanup_would_delete`, `cleanup_deleted` and
`rollback_failed`. Logs contain fixed outcomes/status codes/generated IDs, not
content/emails/tokens. Compare object counts/ages with sweep duration; alert on
stopped progress, growing retries or incoming objects approaching scan capacity.
Do not increase batch size without revisiting the subrequest budget.

Outages retain data and retry on subsequent sweeps. For a corrupt/invalid cursor,
stop Cron, inspect inventory/errors, and after owner approval reset only the
control object to `{schema:1}`. Never bulk-delete assets to repair progress.
Turning mode off or disabling the trigger uses the approved deployment process;
code rollback cannot restore deleted files. Keep backups as required by policy.

## Owner-controlled removal, legacy data and rollout

Before removing any PR-associated or previously published file, a maintainer
must establish affirmative intent: review the exact UUID/key/PR and publication
history, confirm intentional rejection or actual inactivity (including comments
and reviews), or merge an intentional catalog removal PR through normal review.
Record owner approval for the exact key and reason in an auditable place. A
rename/automatic/unexplained closure or missing lookup is insufficient.

Stop cleanup and submission merging for the removal window, check current
main/receipts and every open PR for references, confirm independent approval,
keep a backup if desired, then use R2 admin tools for only the approved key.
Retain permanent approval receipts afterward. Coordinate restoration/reopening
and catalog rollback separately; never restore a PR/catalog referencing a
manually deleted object without restoring the file and revalidating. This is a
manual owner operation, not a public or automated deletion API.

Legacy record-only PRs remain blocked with resubmission guidance. Legacy assets,
missing associations and interrupted `creating` records retain. The owner can
verify and repair a stable PR association through admin tools or approve per-key
removal; there is no automatic migration or inference from a missing branch.
The same explicit procedure resets disposable prelaunch test data; no blanket
bucket/prefix deletion is authorized.

Worker credentials remain repository-scoped Contents/PR read-write for upload
PR creation, with no main bypass/admin/workflow permission. Cron now uses only
GitHub reads. The publication App separately needs only Checks write/Metadata
read, with its secret isolated as described in enforcement docs. Verify OAuth,
Turnstile, exact CORS, R2 write isolation/public host, config origin and Pages
integration. Never put blanket lifecycle expiration on `assets/`.

Before launch, owner-approved isolated staging must exercise sign-in/rejections,
one-PR upload, the unchanged form/waiting message, anonymous asset GET and denied
anonymous writes/deletes, approval→Pages publication, concurrent reconciliation,
API/rollback/storage failures, and the conservative cleanup holds. Prove rename
closure survives 12 hours and seven days and reused branches are untouched. Start
Cron in dry-run and approve active mode separately. Run the hosted spoof/rerun
acceptance tests in [publication enforcement](publication-enforcement.md). Record
SHA, check App identity, ruleset/environment settings, deployment IDs, quotas and
rollback plan before requesting a production release.

Accepted limits: pending content is public and not malware-scanned; trusted
writer/admin or App credential compromise can defeat protection; outages and
backlogs delay orphan cleanup; manual rejected/abandoned cleanup is now required;
checks have a final authorization/merge interval and are not a merge-time
transaction. Local mocks/workerd do not establish production correctness.
