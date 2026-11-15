# PR #26 production cutover preparation

Prepared from PR #26 HEAD **906f37ec71fd4663f7a2d27acd728cae251d4efe**, which
includes merged PR #28. This is a preparation record, not deployment authority.
No merge, deployment, routing/configuration mutation, live submission, migration,
data deletion, new review cycle or hosted acceptance campaign was performed.

## Ready and blocked

The private moderation architecture and essential real Google/Turnstile/UI
staging lifecycle already passed; preserve [that evidence](student-staging-final-acceptance.md).
PR #28 added locally verified permission receipts and policy integration; its
schema 0003 is **not remotely applied**. No staging campaign needs repeating.

Prepared here: separate production Wrangler template, local-only release
generator, staged routing configurations, legacy pause configuration, all three
migration hashes, blocked-policy Pages build guard, and explicit contributor
mode. Production mode keeps signed Google verification, verified email/exact
student domain, exact-origin CORS, Turnstile, declaration/version, private
storage, Access/JWT/allowlist checks and moderation controls. Missing mode keeps
staging's account allowlist and one-hour cutoff; unknown modes fail closed.
Generated production releases always have `SUBMISSIONS_ENABLED=false`.

**Not ready for public publication or real intake:** Privacy Notice and
Contributor Declaration remain review drafts. Do not remove their banners as an
engineering shortcut or publish them as operative notices. Resolve the existing
legal/provider/date/location/backup facts, electronic-permission sufficiency and
retention/rights operations in [the coherence report](legal-technical-coherence.md).
Production resource locations/plan and actual log/backup lifecycle must be
recorded, not inferred from staging. RA-JWT-01 remains OPEN: independent hosted
Worker JWT rejection/session evidence is unverified. A recorded owner disposition
is required before onboarding; deferred checks are not passes. This preparation
does not commission that work or another review.

## Read-only live observations — 15 November 2026

Cloudflare account `1b409400fea16e7142f62ac19ecd361d`, zone `rootamman.com`
`fc80d6a45a703d0fe4d1876f1380870f`. Inspected account resource lists, Worker
settings/deployments/subdomains/schedules, domains/DNS, Access/IdP, Turnstile
widget metadata, R2 object/domain metadata, Pages configuration/all 83 deployment
records, WAF/rate-limit rules and Page Rules. Secret values and object bytes were
not retrieved. API metadata is evidence of configuration, not runtime acceptance.

| Existing resource | Observed state |
| --- | --- |
| Pages `root-archive` | `archive.rootamman.com`, `root-archive.pages.dev`; canonical `60b32faf-7934-4e5b-8a34-c07c1cb0983d`, main `4bb136b9a39423737be4ee30ba1239d735e221c9`; no content migration expected from the recorded empty catalog. Recheck emptiness at release. |
| Pages build | Git production auto-deploy ON, branch `main`, command `exit 0`, output `site`. Previews custom include `*`, exclude `submission/*`, `submission-*`. PR #26 HEAD already produced preview `acb0b65c-fc67-4193-bb33-76b4a40169d0`; exclusion settings do not retire old deployments. |
| Legacy `root-archive-worker` | Custom domain `api.rootamman.com`; workers.dev and version previews ON; active version `e8895ac0-b95b-409e-aff1-af3f549be94f`, deployment `88fef60a-22b0-434a-bbc2-89ac0d569629`; no Cron. Dashboard-deployed; no live pause flag. Bound to public bucket and GitHub/Turnstile secrets. |
| Legacy bucket `root-archive-assets` | Both r2.dev and `assets.rootamman.com` public; four objects; open submission PRs #1/#2/#3/#21 and eight successful historic previews. Exact metadata in [legacy-artifacts.json](../production/legacy-artifacts.json). |
| Staging | D1 `root-archive-moderation-staging` / `f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6`; R2 `root-archive-private-staging`, empty and private; backend `root-archive-moderation-staging` version `0f8024b1-b62d-4aff-a8bc-8f7b521498f5`, submissions false, window timestamps empty, Cron off, alternate hosts off. |
| Staging routing | `admin.archive.rootamman.com` and `api-staging.rootamman.com` → staging backend; `archive-staging.rootamman.com` → separate student Worker. Do not repoint these. |
| Staging Access | App `bebba566-18d3-42c5-a78e-50213ea2dad6`, entire admin hostname, exact-email Allow policy, email PIN, one-hour session, binding/HTTP-only cookies, no preflight bypass. Preserve app, AUD, policy and IdP. |
| Production private resources | No production private bucket, D1, moderation Worker or Access app exists. `moderation.rootamman.com` has no observed DNS/domain assignment. |
| API security | Existing scoped rate limit `root_archive_api_post_burst`: 60/10s/IP, 10s block, includes `/submit` and `/auth/verify`. `root_archive_rate_scope_guard` restricts it to `api.rootamman.com` POST. No cache-phase ruleset or legacy Page Rule observed; recheck before switching. |

## Exact intended production configuration

Names and hosts below are the proposed authorization scope. IDs marked new are
intentionally unknown until creation; never substitute staging IDs to proceed.

| Component | Required configuration |
| --- | --- |
| D1 | NEW `root-archive-moderation-production`, binding `DB`, new UUID, fresh empty database, read replication disabled. Record actual location and backup/plan facts. EEUR location hint may match staging operationally; it is not a Jordan-only residency guarantee. Resolve the intended location before creation. |
| R2 | NEW `root-archive-private-production`, binding `PRIVATE_FILES`, Standard storage; no r2.dev, custom domains, public CORS or lifecycle deletion bypass. Record actual location/jurisdiction. Never copy staging rows/files/receipts or legacy tests. |
| Worker | NEW `root-archive-moderation-production`, `moderation.ts`, compatibility `2026-10-30` (same verified runtime), admin assets `run_worker_first=true`, workers.dev and preview URLs false; separate production DB/R2 only, no GitHub credentials. |
| Administrator | NEW `https://moderation.rootamman.com`, chosen to preserve the successful staging host/Access configuration and use a single-level zone hostname. NEW entire-host self-hosted Access app/AUD on issuer `https://rootamman.cloudflareaccess.com`; existing email-PIN IdP may be reused. Copy approved exact-email policy intent, never an Everyone/BYPASS/student-domain rule. One-hour session, binding/HTTP-only cookies, preflight bypass false; matching `ADMIN_EMAILS` secret. Confirm TLS before routing. |
| Public API | Move only `api.rootamman.com` from legacy to production moderation Worker during cutover; `/resources`, `/download/:uuid`, `/auth/verify`, `/submit`. Legacy `POST /` becomes 404; old tabs reload. No admin assets/API on this host. No wildcard routes needed. |
| Origins | `ADMIN_ORIGIN=https://moderation.rootamman.com`; `PUBLIC_API_ORIGIN=https://api.rootamman.com`; exact `ALLOWED_ORIGIN=https://archive.rootamman.com,https://root-archive.pages.dev`. No staging or arbitrary preview origins. |
| Google | Existing production Web client `451085424306-tll56iseq0qd9lcofeb1nkiqiaq0opvh.apps.googleusercontent.com` is the candidate; confirm actual authorized JS origins are the two production frontend origins and Audience/consent permits eligible `std.aum.edu.jo` accounts. Google dashboard state was not available through Cloudflare; frontend ID is not proof. Backend/frontend IDs must match; do not use staging client `…3akhui…`. No OAuth client secret is required by the ID-token path. |
| Turnstile | Existing production managed widget `0x4AAAAAAFtYsxdbI-Zx8mjy`, observed hostnames `archive.rootamman.com`, `root-archive.pages.dev`; provision matching `TURNSTILE_SECRET` directly into NEW Worker via protected JSON secret file. Do not rotate the existing widget during legacy pause or copy the staging secret. Siteverify remains required server-side. Secret value/match was not inspected. |
| Scheduled cleanup | `CLEANUP_ENABLED=true` plus `*/5 * * * *` UTC on production Worker. Existing bounded cleanup processes expired upload intents and durable deletion retries; validate actual invocation/progress and monitor backlog. It does **not** implement 30-day pending expiry, 7-day withdrawn removal, permission/audit purges or legal holds. A real deadline/rights operation is still a publication blocker. Mutation-triggered cleanup can delete eligible files even without Cron. |
| Pages | Keep project/domains and production branch `main`. Disable automatic production deploys before any merge; use no new previews during cutover. After legal resolution, commit actual nonsecret `production/release.json`, use Node 24, build `npm ci --ignore-scripts && node scripts/prepare-production.mjs production/release.json --pages`, output `dist/production`. Retain submission branch exclusions; previews None or only approved trusted branches. Never deploy raw `site/` as the private release. |
| Cache/logs | Preserve no-store on public catalog/download and all private routes; no cache-everything override. Same restrained observability as staging (invocation logs off, traces sampled 0.1); establish actual provider retention/access/log settings and backups for the Notice. |

## Local artifact preparation

`worker/wrangler.production.jsonc` is a **template**, not a deployable config with
verified IDs. After authorized resource creation, copy
`production/release.example.json` to `production/release.json` and fill the new
production D1 UUID/AUD and confirmed public client/widget identifiers. This file
contains no secrets. Keep both policy approvals false until their requirements
are actually resolved. The generator makes no API calls:

```sh
node scripts/prepare-production.mjs production/release.json
# After publication blockers are resolved and approved:
node scripts/prepare-production.mjs production/release.json --pages
```

Outputs under ignored `worker/.wrangler/production/`: `moderation-unrouted.json`,
`moderation-admin.json`, `moderation-cutover.json`, `legacy-paused.json`, and a
manifest with ordered migration SHA-256 hashes. Optional Pages output is
`dist/production`. All generated backend phases keep submissions false.
The Pages option rejects missing approvals, remaining draft/blocker wording,
stale generated policies and a nonempty legacy static catalog. This is an
engineering guard, not a determination of legal sufficiency. Existing Pages
`exit 0` bypasses it: dashboard build/auto-deploy changes are a mandatory release
step, not something this repository edit has already enforced remotely.

## Authorized deployment sequence — do not execute during preparation

Each remote step requires final production authorization. Use the recorded
release SHA, never an unpinned moving PR head. Re-fetch PR #26 HEAD and check the
release delta if it changed; that is provenance checking, not another review cycle.

1. **Resolve gates and contain publishing.** Record legal/publication and
   RA-JWT-01 dispositions, operative policy versions and operational owners.
   Disable Pages automatic production deployments before merging #26; restrict
   previews and record canonical deployment/old Worker versions. Re-inventory
   current main and live Pages catalog, four legacy objects/PRs/previews and
   routes. If catalog/data changed, stop the empty-database cutover and reconcile
   explicitly. Never infer contributor authorization for historical material.
2. **Provision without traffic.** Create the NEW private bucket and D1 with the
   agreed location/plan, verify zero objects and zero application tables/rows and
   public R2 endpoints disabled. Create NEW entire-host production Access app;
   retain staging app/policy/AUD/hosts. Supply production UUID/AUD to release
   settings and generate route-free config. Keep secrets in an owner-controlled
   protected JSON file containing only `ADMIN_EMAILS` and `TURNSTILE_SECRET`,
   outside Git; never put values in shell arguments or evidence. Verify the
   intended account/service/bindings before each remote operation.
3. **Initialize schema, once, before Worker.** Inspect D1 metadata/name/UUID and
   `sqlite_schema` first. A fresh DB must have no application schema or data;
   inspect any existing `d1_migrations` table. Compare local hashes in manifest
   with the pinned release and list unapplied migrations. For a genuinely fresh
   production DB the list must be exactly, in order:

   `0001_private_moderation.sql` → `0002_catalog_generation.sql` →
   `0003_contributor_authorizations.sql`.

   Only after those checks, from `worker/`, use the installed Wrangler:

   ```sh
   node_modules/.bin/wrangler d1 execute root-archive-moderation-production --remote --config .wrangler/production/moderation-unrouted.json --command "SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name"
   node_modules/.bin/wrangler d1 migrations list root-archive-moderation-production --remote --config .wrangler/production/moderation-unrouted.json
   # MUTATION: execute only after inventory, exact unapplied list and authorization:
   node_modules/.bin/wrangler d1 migrations apply root-archive-moderation-production --remote --config .wrangler/production/moderation-unrouted.json
   node_modules/.bin/wrangler d1 execute root-archive-moderation-production --remote --config .wrangler/production/moderation-unrouted.json --command "SELECT id,name FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check; SELECT COUNT(*) AS submissions FROM submissions; SELECT COUNT(*) AS receipts FROM contributor_authorizations; SELECT COUNT(*) AS resources FROM resources;"
   ```

   Expect three migration ledger entries, no FK violations, empty submissions/
   receipts/resources, singleton cleanup/catalog state and the catalog/receipt
   triggers. No data import or acceptance backfill. On any error, stop and inspect
   ledger/schema before applying **only** genuinely unapplied migrations; earlier
   migrations can have committed. No blanket retry/reset or direct SQL replay.
   Staging already has 0001/0002: do not reapply them; staging 0003 is separate
   maintenance, not a prerequisite to or authorization in this production plan.
4. **Deploy paused private service.** From `worker/`, dry-run then deploy
   `.wrangler/production/moderation-unrouted.json`, using installed Wrangler
   `deploy --config ... --secrets-file /protected/path/production-secrets.json`.
   This provisions code/assets/Cron without a public route. Then deploy
   `moderation-admin.json` only after Access coverage is in place. Confirm the
   distinct admin TLS/Access/session/allowlist and disabled alternate hosts.
   Read back DB/R2, paused flag, full-host gate and five-minute Cron. Staging
   remains untouched. Wait for a scheduled invocation/cleanup_state progress;
   record it without manufacturing a large queue.
5. **Pause and drain legacy intake.** Deploy generated `legacy-paused.json` to
   `root-archive-worker`; confirm current live bindings against the observed
   dashboard state first (no secret rotation). It preserves the public bucket,
   pauses upload routes `/` and `/submit` with `LEGACY_SUBMISSIONS_ENABLED=false`,
   disables workers.dev/version previews and leaves cleanup off. Verify `/` and
   `/submit` cannot upload on the custom host or old alternate hosts; check
   historic version aliases are unreachable. `/auth/verify` may still verify
   identity on the paused legacy custom host, but cannot write data; after the
   route handoff it belongs to the private handler. Allow in-flight work
   to finish; observe stable object count/PR state and classify any change.
   This legacy pause deployment is necessary because the old deployed version
   does not read the new flag. A frontend switch alone cannot retire old intake.
6. **Switch the empty public archive.** Retarget the `api.rootamman.com` Custom
   Domain from legacy to new Worker in the maintenance window (detach/attach if
   required; never change a zone-wide wildcard). Deploy `moderation-cutover.json`
   still paused. Do not redeploy legacy config afterwards and reclaim that host.
   After authorized merge of #26 plus preparation changes and resolved policy
   artifacts, configure the guarded Pages build/output above and publish the
   exact release commit. Coordinate backend/frontend/declaration version. Keep
   submissions false. Verify the production-specific checks below before opening.
7. **Accept a single synthetic production canary, then real intake separately.**
   After legal/security dispositions and explicit canary authorization, temporarily
   deploy cutover config with CLI `--var SUBMISSIONS_ENABLED:true`; use one
   authorized eligible account and one synthetic file only. Re-pause immediately
   with the unchanged cutover config; its saved flag is false. Verify new schema
   0003 receipt and the short lifecycle below. Permanent canary removal needs
   explicit exact-ID/key authorization; retain receipt/audit/tombstones. Once the
   result and any required cleanup are recorded, a separate final authorization
   enables real submissions. Persist true in the approved release configuration
   for that release so a later redeploy does not unexpectedly re-pause. No tool
   here automatically enables either canary or real intake.
8. **Retire legacy publication surfaces separately.** Hold the four known tests
   outside the new database/bucket/catalog. After exact disposition approval,
   close the four PRs without merging; revoke old R2 public endpoints, purge
   managed CDN copies and retire all eight historical deployment URLs/aliases
   identified in the manifest, then verify denial. Only with separate explicit
   deletion authority remove those exact objects after size/ETag recheck. No
   wildcard bucket wipe, blind PR import or automatic historical receipt. Code
   visibility/PR closure cannot recall already saved copies or erase Git history.
   After replacement stability, revoke legacy Worker GitHub token and unused
   publication App credentials/install, and retire its reporter/workflow together
   with **only** the App-bound `Submission policy` requirement. Keep other required
   checks/protections. Do not remove the required reporter/check out of sequence
   and block the release. Remaining dead legacy code can wait; no refactor here.

## Minimum production-specific acceptance (future authorization required)

- Read-back: pinned Worker/Pages commit/version, new D1/R2 identities, migrations
  0001/0002/0003, private R2 endpoints, exact origins/client/widget, separate Access
  AUD/policy/secret names, no alternate Worker/preview endpoints, paused intake,
  rate rule still applying to API POST, Cron installed and one observed progress.
- Routing boundary: production admin login/session works on the new hostname;
  anonymous/forged admin request denied, public-host admin 404, disallowed-origin
  preflight denied. This verifies the new production wiring; do not relabel it
  independent hosted JWT verification or repeat the staging negative matrix.
- Pages points to private `/resources` and `/submit`, no static fallback, empty
  anonymous catalog; operative approved policy pages/version match the receipt
  snapshot. Legacy custom/alternate paths reject uploads; old tabs fail safely.
- One authorized synthetic file through actual production Google/Turnstile/UI:
  pending absent publicly; protected receipt has exact declaration, identity,
  file SHA-256 and event; approve → exact anonymous GET/HEAD bytes/no-store;
  withdraw → fresh same-URL GET/HEAD 404; re-pause → new submit denied with no
  writes. Separately authorized exact-file removal checks durable cleanup while
  retaining permission/audit evidence. No 205-record campaign, races, artificial
  faults, image-editor rerun, broad browser campaign or another code review.

## Stop / recovery

Any wrong binding, public private-bucket endpoint, unexpected data/catalog,
Access/TLS failure, schema mismatch, legal gate, or inability to pause is a stop.
Before traffic moves, leave legacy paused and public Pages at its recorded safe
version as appropriate; do not resume intake just to restore availability.
After any private acceptance, pause submissions and fix forward with schema 0003
and compatible Worker/UI. Keep D1 revocations, private R2, permission receipts,
audits and tombstones. Never restore public uploads/static catalogs as rollback;
do not restore a D1 backup over later revocations or drop 0003. Worker rollback
does not restore database/object state.

## Authorization boundary and focused validation

Final owner production authorization is needed for merge/Pages controls and
publication, resource creation/location, production Access/secrets, schema
mutation, Worker/Cron deployment, legacy pause and route handoff. Canary upload,
its exact cleanup, real intake, legacy public-host/preview retirement, credential/
required-check retirement and any production object deletion must be explicitly
covered; they are not inferred from preparation approval.

Focused local checks (Node 24.22.1, locked Wrangler 4.156.0):

- `npm --prefix worker run typecheck`: PASS, including regenerated bindings.
- `npm --prefix worker run check:moderation-bundle`: PASS.
- `node --test scripts/production-preparation.test.mjs scripts/student-staging.test.mjs`:
  **7/7 PASS** (two new production preparation checks, five existing staging
  preparation guards).
- `node --test --test-name-pattern='production mode|staging account allowlist|server cutoff' worker/tests/moderation.test.mjs`:
  **3/3 PASS**, with a fresh local D1/R2 and all three schema files. External
  Google/Turnstile are signed/mock fixtures; nothing reaches live application
  services. Tests cover production eligibility/pause/receipt privacy and unchanged
  staging allowlist/cutoff behavior.
- Installed Wrangler `deploy --dry-run` on generated `moderation-cutover.json`
  and `legacy-paused.json`, with visibly synthetic UUID/AUD/client settings under
  `.wrangler/production-local-validation/`: PASS. No real production resource IDs
  or secrets were available/used for these checks.
- Generator syntax and `git diff --check`: PASS.

Wrangler commands used `XDG_CONFIG_HOME=/tmp/root-archive-config` and
`WRANGLER_SEND_METRICS=false`; local runtime checks required loopback permission.
No broad suite, staging campaign or independent review was restarted. No local
result proves production behavior. Reference: [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/),
[Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/),
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).
