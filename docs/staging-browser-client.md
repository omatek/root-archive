# Hosted Group B browser client — review candidate, not executed

The owner requested preparation and **independent review before execution or
any additional seeding**. That hold remains in force. No command below is
authorization to execute now. This is a test operator tool, not a deployed
application feature. Independent review is **PENDING**; author checks are not
independent review or hosted acceptance.

Review the complete [client](../scripts/staging-group-b-browser.js) and
[offline guard tests](../scripts/staging-group-b-browser.test.mjs) at the same
PR #26 commit. No browser package, deployment, service token or Access change
is needed. There is no shared-browser control tool available to Codex; the
owner would operate their existing authenticated tab themselves.

## Scope and effects

| Category | Commands | Effect |
| --- | --- | --- |
| Load | Paste the reviewed file as a DevTools Snippet | Defines `window.rootArchiveStagingAcceptance`; zero requests |
| Read only | `inspect`, `inspectRecovery`, `readCatalog`, `cleanupPlan`, `report` | GET requests or in-memory receipt; no POST |
| Mutations | `metadataRace`, `replacementRace`, `interruptReplacement`, `approvalRace` | n=4 only; normal moderation API; temporary synthetic publication |
| Mutations | `publishPagination`, `withdrawBoundary`, `republishBoundary` | n=5..205 only; 201 approvals, two withdrawals, two reapprovals |
| Destructive, separately gated | `cleanup` | Permanent removal of one explicit scope, version/hash checked; retained tombstones/audit |

Only `https://admin.archive.rootamman.com` in a top-level tab is accepted.
Normal administrator requests use its existing browser session; public GET/HEAD
requests go only to `https://api-staging.rootamman.com` with credentials omitted.
Redirects are errors. The client does not read cookies, PINs, JWTs, authorization
headers, session/local storage, or the session API; it uses no external imports,
analytics, clipboard, download/export, persistent state or arbitrary URLs.
Private detail responses stay in function-local memory; output contains fixed
messages and synthetic IDs/statuses/versions only, never raw audit actors,
moderator identities or response bodies. No HAR/network export is needed.

Submission IDs are exactly `726f6f74-6172-4368-8000-<12-digit hex n>`.
n=1..3 are historical read-only fixtures, now terminal with every file deleted.
n=4 is the remaining recovery/race fixture; n=5..205 are exactly 201 pagination
fixtures. Initial revision IDs use `9000` in place of `8000`.
All use course `0401111`, type `Summary`, semester `Synthetic`, null contributor
identity and the exact documented synthetic PNG SHA256
`1324f212d3fdc38a04671664d9e87bf203d9982696eeff2373ce4ea9f1251383`.
n=4 replacements reuse those same checked artificial bytes with filename
`synthetic-client.png`. No local file picker or real content is used.
At most three new n=4 replacement intents are allowed (two overlapping, one
interruption attempt). Together with n=3's existing replacement, this fits the
campaign limit of ten. The script refuses more than four n=4 revision rows.

**Deletion effects also occur before final cleanup:** the existing replacement
API deletes superseded edited drafts and abandoned uploads; approval deletes
unused revisions, including originals. These are existing moderation semantics.
Every such route can invoke the server's global bounded cleanup internally.
The client exposes no `/cleanup`, D1, R2 or seed endpoint. Code/database rollback
cannot restore deleted R2 bytes. Only synthetic files may be present when it runs.

## Independent review and execution prerequisites

The owner-selected independent reviewer should record the reviewed full commit
SHA, client SHA256 (`sha256sum scripts/staging-group-b-browser.js`), decision,
findings and any required fixes in PR #26 or a repository evidence file. Review:

- Exact origin, routes and n=4/n=5..205 write boundaries; no n=1..3 writes.
- No credential reads/exfiltration, external code or raw private output.
- Synthetic metadata/content/revision caps, all-target validation before bulk
  publication, and strict state/version checks before each decision.
- Each mutation's exact phrase, separate cleanup scope/plan hash and mandatory
  fresh ownership check; automatic server cleanup effects described above.
- Race accounting (one 200/one 409), bounded loops, no write retry after uncertain
  transport, and no claim that a client abort proves server receipt or an outage.
- API-issued pagination cursors, membership/duplicate checks, withdrawal denial
  and generation invalidation. No constructed cursor substitutes for traversal.

Before **each live mutation phase**, Codex must independently confirm read-only:
the existing Worker version/bindings; staging-only D1/R2; submissions disabled;
no other operators; all D1 revisions, including invisible receiving/uploading
intents; and the complete R2 inventory against the expanded ownership manifest.
The browser inventory sees only visible admin records, not hidden intents or
global R2. It cannot replace this external check. Stop on any unknown object,
identity, record, security failure or unresolved upload/deletion.

Current state is n=1 removed/v6, n=2 rejected/v3, n=3 removed/v7, **zero R2
objects**. n=4..205 remain **unseeded**. After independent review and explicit
owner execution approval, seed n=4 first using the existing approved seed plan,
record ownership/hash/readback, then run its phases. Do not seed the 201 records
until n=4 has been reconciled and held private or removed. Seeding remains a
separate Codex management-API operation; never give the browser management
credentials. No migrations, deployments or configuration changes are involved.

## Owner instructions after review and approval only

Use the existing signed-in tab at `https://admin.archive.rootamman.com/`.
Complete email PIN yourself if required. Open DevTools → Sources → Snippets,
create a snippet, paste the complete reviewed client file and run that snippet.
Do not paste from a different revision or load code from a remote URL. If browser
policy prevents this, stop and report the limitation; do not disable protections.
The initial load makes no request. Then, in that tab's Console:

```js
const acceptance = window.rootArchiveStagingAcceptance;
await acceptance.inspect(); // READ ONLY
```

Run each phase separately, wait for its receipt and Codex's independent state
verification, and proceed only if `outcome` is `completed`. A stopped receipt
requires reconciliation, even if the page seems unchanged. No run-all command
exists. Do not operate the portal or another tab while a phase runs. Read-only
commands are allowed during a mutation hold; no subsequent mutation is allowed.
Report only the returned receipt/visible error, never Network headers or tokens.

### n=4: races and interrupted request

After n=4 is seeded and external preflight passes:

```js
await acceptance.metadataRace('MUTATE SYNTHETIC 4 METADATA');
```

Two simultaneous edits at version 1 must return one 200/one 409, advance once,
and leave the file private. Next, following independent reconciliation:

```js
await acceptance.replacementRace('MUTATE SYNTHETIC 4 REPLACEMENTS');
```

Two simultaneous uploads at version 2 must select one candidate/version 3;
the losing request must conflict and any created losing intent must reconcile.
Both requests contain the exact artificial PNG. Hold if any intent is unresolved.

```js
await acceptance.interruptReplacement('INTERRUPT SYNTHETIC 4 ONCE');
```

One request is aborted by its client after 200 ms. It may finish first, commit
after interruption, or never reach the server. The receipt distinguishes an
observed HTTP response from unconfirmed transport. **Every outcome imposes a
mutation hold and external reconciliation.** Codex must inspect D1/R2/audit
and confirm eventual ready/deleted state and private bytes. A request not received
does not pass hosted interrupted-operation recovery. Do not repeat the attempt
or change bindings, clocks, cleanup deadlines or authentication to force failure.

Only after Codex confirms safe state, reload the tab and reinstall the same
reviewed client (its hold cannot be cleared programmatically). Re-establish the
`acceptance` variable, then:

```js
await acceptance.approvalRace('MUTATE SYNTHETIC 4 DECISIONS');
```

This approves the ready candidate, checks anonymous exact bytes, replays the
identical approval body without another version increment, then sends approval
versus withdrawal at the same current version. It requires one 200/one 409 and
ends unpublished with fresh anonymous GET/HEAD denied. Codex verifies actual
audit counts, selected revision, unchanged private bytes and cleanup independently.
Natural storage failures are recorded and reconciled; injected storage/D1
failure tests remain local-only and outside this client.

### n=5..205: 201-record pagination, minimal manual commands

After the 201 exact fixtures are approved for seeding, seeded and independently
verified (n=4 must be private or removed), these are three separate commands:

```js
await acceptance.publishPagination('PUBLISH SYNTHETIC 5 THROUGH 205');
```

It checks every target/file before the first approval, then approves sequentially
through the real API. Already-published exact targets can be skipped after a
reconciled interruption/reload. It follows an actual API-issued cursor and
requires exactly 200+1 unique expected IDs, and checks two public file hashes.
There are 201 server approval operations, **one manual command**. Allow several
minutes; don't close/reload. No browser timeout of the whole campaign is imposed;
each request has a 30-second bound. Codex saves independent public traversal,
download and D1/audit evidence before the next command.

```js
await acceptance.withdrawBoundary('WITHDRAW TWO SYNTHETIC BOUNDARY RECORDS');
```

It traverses 201 records, withdraws one from each side of the page boundary,
checks fresh GET/HEAD denial, requires the old API-issued cursor to return
409 `catalog_changed`, and requires a complete fresh 199-record catalog excluding
both IDs. It leaves files private and intact for independent R2 verification.

```js
await acceptance.republishBoundary('REPUBLISH TWO SYNTHETIC BOUNDARY RECORDS');
```

It reapproves exactly the two unpublished pagination records, verifies their
public bytes and all 201 stable resource IDs across 200+1 pages. Codex verifies
fresh public responses and retained audit/version transitions independently.

### Separately gated destructive cleanup

Nothing above calls permanent removal. Generate a **READ ONLY** plan first:

```js
await acceptance.cleanupPlan('recovery'); // n=4 only
// OR, after pagination acceptance:
await acceptance.cleanupPlan('pagination'); // n=5..205 only
```

Show the sanitized plan/its hash to Codex for external D1/R2 ownership and
recovery review. Each ready revision is hash-checked. Do not proceed without the
owner's separate cleanup go-ahead for that scope. These are the complete commands
to use only after that check, substituting the actual reviewed plan hash:

```js
await acceptance.cleanup('recovery', 'REPLACE_WITH_REVIEWED_PLAN_HASH',
  'DELETE OWNED SYNTHETIC STAGING RECOVERY');
// Separately approved pagination cleanup:
await acceptance.cleanup('pagination', 'REPLACE_WITH_REVIEWED_PLAN_HASH',
  'DELETE OWNED SYNTHETIC STAGING PAGINATION');
```

Cleanup re-reads the whole plan before starting and each record before removal.
Changed versions/statuses/revisions or unresolved intents stop it. Already removed
exact tombstones can be skipped with a new plan after reconciliation. It checks
fresh download denial, deletion progress, catalog-generation invalidation on
initial pagination removal and the final empty catalog. It never deletes D1
rows. A pending deletion stops the run; Codex reconciles deadlines and ownership
before any existing cleanup retry. Final physical R2 absence, scrubbed metadata,
foreign keys and retained audit/tombstones still require independent verification.

`acceptance.report()` returns only the latest sanitized receipt. Save phase
receipts to repository evidence through Codex; screenshots, HARs and credentials
are unnecessary. Preparing/reviewing this client passes **no additional hosted
application tests**.
