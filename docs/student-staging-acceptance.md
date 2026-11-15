# Real student staging acceptance

Status: **Staging-only configuration and initially paused deployment APPROVED;
setup in progress. Live acceptance and submission enablement NOT authorized.**
Baseline: `6ab4023bc628107dc6e07c5c5937fcbf64a3a1c6`, existing PR [#26](https://github.com/omatek/root-archive/pull/26).
The owner prioritizes this run over fixture 4 and the 201-record campaign. Those
campaigns remain deferred, unseeded, and are not prerequisites for this run.
The latest owner instruction moves fixture 4's deterministic concurrency tests
and focused pagination to merge/launch acceptance. The artificial 200 ms client
interruption test is no longer an acceptance gate; preserve its historical code
and evidence without requiring or running it.

## Verified missing configuration

[Read-only preflight](student-staging-preflight.json), 15 November 2026 UTC:

- Moderation version `bb9e96b3-e789-47b0-aa92-16168fe80db4` remains active,
  attached to the existing admin/API-staging domains and staging D1/R2 only.
  Google client is empty, `TURNSTILE_SECRET` absent, submissions/cron false.
- `archive-staging.rootamman.com` has no DNS record or Worker domain. The only
  Turnstile widget covers the two production frontends. Google project settings
  and availability of an authorized eligible account are not yet verified.
- D1 retains exactly n=1 removed/v6, n=2 rejected/v3, n=3 removed/v7; four
  deleted revisions, two removed resource tombstones, 13 audits, no FK violations.
  All inspection queries wrote zero rows. R2 is empty, r2.dev disabled, no domains.
- Production Pages deployment `60b32faf-7934-4e5b-8a34-c07c1cb0983d` and legacy
  deployment `88fef60a-22b0-434a-bbc2-89ac0d569629` match prior evidence.
  Git remote PR head equals baseline. GitHub REST/GraphQL metadata reads were
  forbidden here; current draft/review/check status was not independently refreshed.

## Prepared implementation

`scripts/prepare-student-staging.mjs` copies the actual `site/` UI into ignored
`dist/student-staging/`, enables private moderation only in that copy, and points
catalog/auth/submission at `https://api-staging.rootamman.com`. It adds a synthetic
staging notice and noindex/no-store headers. There is no static resource fallback.
Production `site/js/config.mjs`, Pages settings, legacy code/config and catalogs
are unchanged. A separate asset-only Worker `root-archive-student-staging` has
no D1/R2 bindings and disables workers.dev/version URLs. Its only proposed domain
is `archive-staging.rootamman.com`; it is reachable by URL, with noindex rather
than an Access gate that would interfere with student sign-in.

The backend release configuration retains both existing staging routes and exact
storage IDs, preserves `ADMIN_EMAILS`, defaults to submissions paused and cron
off, and requires three secret bindings. The new `STAGING_STUDENT_EMAILS` secret
lists only approved test accounts. Empty/missing configuration fails closed;
Google signature/audience/verified-email/exact school-domain checks still run
before allowlist checks on both `/auth/verify` and `/submit`. No identity enters
the frontend or Git. This restriction must be deliberately configured/revisited
for any later production release.

`--paused-setup` explicitly permits an absent Google client **only while paused**.
The staging notice and sign-in panel explain that setup is incomplete; the UI
does not call Google with an invented client ID. This flag cannot be combined
with `--enable-submissions`. Public widget/client values live in
`staging/student-public-config.json`; environment values can override them.
Until the owner configures the eligible account, the protected allowlist contains
the non-email sentinel `staging-account-not-configured`, which authorizes nobody.

The generated **687-byte valid one-page PDF** contains only artificial practice
text. SHA256 `f225b67a86db912394042bca309b0691727e22ef3bd741b044ec0543906151d1`.
It is written to `dist/student-acceptance.pdf`, outside the served assets. The
actual UI must upload it; do not seed D1 or choose reserved campaign IDs.

## Approval scope — external setup first

Approval is required by the owner's current request and AGENTS.md's rule:
"No deployments, production simulations, live configuration changes, or
real-data collection without explicit human approval."

The owner approved staging configuration and initially paused deployment from
commit `e9f72a46a589a19a38d1ad4f35bba0ca6428104f`. This authorizes setup in
items 1–2 and the paused portion of item 3. The active window and all live
student/moderator actions in items 3–5 remain separately gated. Submissions must
stay `false` until a later explicit live-acceptance approval.

1. Create a **separate** staging Google Web OAuth client/consent configuration
   and a **separate** managed Turnstile widget for `archive-staging.rootamman.com`.
   Preserve production OAuth client/origins and widget. No paid-plan changes.
2. Create the asset-only staging Worker and its one new Custom Domain/DNS/TLS;
   update only `root-archive-moderation-staging` with the reviewed code/config,
   staging Google client, widget secret and approved test-account allowlist.
   Preserve the existing admin secret, Access policy/AUD, both existing staging
   domains and storage IDs. Apply **no migrations** (both are already applied).
3. Initially deploy paused; verify secret names/bindings, TLS, frontend settings
   and exact CORS. Enable submissions for one supervised window of at most
   60 minutes, then pause again. No Cron, R2 domain/lifecycle, production routing,
   production Pages, legacy endpoint, GitHub merge or contributor onboarding.
4. If live testing is also approved: one accepted synthetic PDF, one real
   ineligible Google sign-in, one deliberately invalid Turnstile UI submission,
   one paused UI submission, moderator review/approval/withdrawal, and the
   practical logout/reauthentication case below. Up to two Google sign-in retries
   per account; reconcile any ambiguous upload before retrying it. Stop if the
   window expires or any unexpected record/object/configuration appears.
5. Permanent removal and manual cleanup of **only the new UI-created UUID and
   its verified revision(s)** after withdrawal, including scrubbing its stored
   Google email/sub. Preserve n=1..3 and all audit/tombstones. Manual cleanup is
   allowed only after proving every due deletion belongs to this run or is an
   already-deleted historical revision. Unknown work stops cleanup. No direct SQL
   state changes, artificial outages, concurrency/pagination seeding or bulk deletion.

Before deployment, re-read the live settings, account/token scopes, domains,
secret names, storage and production IDs; stop on drift. Bindings drift must be
resolved against the prepared configuration before deployment. Rebuild with real
public staging keys; the local dummy-key build is **not deployable acceptance**.

## Exact owner-assisted setup

Google Cloud (owner authentication required; do not share credentials):

1. Open [Google Cloud Console](https://console.cloud.google.com/), select a
   separate owner-controlled staging project, then **Google Auth Platform**.
2. Set Branding/Audience as required, using Testing where available. Authorize
   only the eligible test identity and a separate owner-controlled ineligible
   Google identity for this synthetic run. If organizational policy prevents
   either account signing in, stop and record the block; do not weaken the
   Worker's `std.aum.edu.jo` checks or use forged tokens.
3. **Clients → Create client → Web application**, name `root/archive staging`.
   Add exactly `https://archive-staging.rootamman.com` under **Authorized
   JavaScript origins**. GIS uses a popup; no redirect URI is needed by this UI.
   Copy the public client ID. No client secret belongs in the frontend or chat.
   Scope/consent publishing requirements depend on the owner's actual project;
   do not assume a test-user setting proves Google will issue either credential.

Cloudflare (can be performed by the authorized agent after setup approval):

1. Create Turnstile widget `root-archive-student-staging`, Managed, hostname
   `archive-staging.rootamman.com`, no pre-clearance. Never edit the production
   widget. Retain its public site key and send its secret directly to the staging
   Worker/protected secret file; never print or commit the secret.
2. Provision `STAGING_STUDENT_EMAILS` with the exact eligible owner-authorized
   account(s), comma-separated, as a protected backend secret. Do not allow the
   ineligible account. Preserve the existing `ADMIN_EMAILS` secret.
3. Supply public values in `staging/student-public-config.json` or environment
   variables `STAGING_GOOGLE_CLIENT_ID` and `STAGING_TURNSTILE_SITE_KEY`, and build
   from the approved commit. While Google setup is pending, use
   `node scripts/prepare-student-staging.mjs --paused-setup`; after the real client
   ID is configured, omit that flag. Both modes keep submissions paused.

```sh
node scripts/prepare-student-staging.mjs
export WRANGLER_SEND_METRICS=false
export XDG_CONFIG_HOME=/tmp/root-archive-config
./worker/node_modules/.bin/wrangler deploy --config worker/.wrangler/student-acceptance/frontend.json --dry-run
./worker/node_modules/.bin/wrangler deploy --config worker/.wrangler/student-acceptance/moderation.json --dry-run --outdir worker/.wrangler/student-acceptance/dist
```

After approval, the two identical commands **without `--dry-run`** deploy the
frontend and paused backend. Backend deployment additionally uses
`--secrets-file /tmp/root-archive-student-secrets.json`, a mode-0600 JSON file
containing only `TURNSTILE_SECRET` and `STAGING_STUDENT_EMAILS`. Existing secrets
omitted from this file are preserved by Wrangler. Keep the protected file only
until deployment is verified; delete it afterwards. Do not run `secret put`
separately: it immediately deploys a version. The generated configs declare
required secret names so a missing secret blocks deployment.

Record the actual deployment/version IDs. For the approved active window,
rebuild using `node scripts/prepare-student-staging.mjs --enable-submissions` and
deploy **only the backend** with the generated moderation config. To pause, run
the builder with no flag and redeploy only that backend. No rollback to the old
deployed code: it lacks the new account gate. Pause first on any unexpected
behavior; retain private files for reconciliation rather than replaying uploads.

This Cloud environment currently permits API/admin/Access hosts but lacks grants
for the new student host, `accounts.google.com`, `www.googleapis.com` and
`challenges.cloudflare.com`. Its authenticated browser-control tools are absent.
The owner can perform sign-in/UI actions in their own browser without changing
Cloud networking. Agent browser execution would additionally require the exact
browser capabilities/network grants; no extra grants are required for the
already-accepted admin TLS/alternate-host checks. Do not export HARs, cookies,
JWTs, PINs, console credentials or browser storage into evidence.

## Minimal live run and evidence checkpoints

The following are pending steps, **not passing results**. Use the normal UI;
owner observations are labeled separately from agent HTTP/D1/R2 verification.

| Step | Owner/browser action | Evidence required before continuing |
| --- | --- | --- |
| Baseline | Open staging directory and Contribute | Exact deployed config; submissions paused; n=1..3 unchanged, zero R2, empty public catalog |
| Ineligible | Sign in with the authorized personal/nonstudent Google account | Actual `/auth/verify` 403 plus eligibility message, draft retained, no new D1/R2. OAuth refusing to issue a credential is a blocked test, not Worker denial |
| Eligible | Switch account; select authorized `@std.aum.edu.jo` identity; complete real Google login and Turnstile | `/auth/verify` 200, verified account UI; no credentials captured |
| Paused | Fill `0401111`, Summary, title `Synthetic student acceptance`, empty semester, public credit off; attach generated PDF; click Submit while backend is paused | `/submit` 503; D1/R2 unchanged; draft/file retained. This proves server pause without creating an upload |
| Turnstile denial | During enabled window, load the reviewed `scripts/staging-turnstile-denial.js` **once** in that staging tab's console, then click Submit in the UI | Loading sends no request; next real UI submit changes only the challenge to known invalid text; `/submit` 403, draft/auth retained, no new D1/R2. Restore by reloading if the helper is not consumed |
| Submit | Let the real widget reset/complete; click Submit once | `/submit` 201 and new random UUID in UI; record UUID, never choose n=4 or a campaign ID |
| Private | Owner opens admin portal; sign in using existing approved Proton email/PIN if prompted; Pending → matching UUID/title | D1 pending/v1, one ready original, no public resource row, `submission_received`; exact R2 key/size/hash match PDF; anonymous catalog excludes UUID, fresh download GET/HEAD 404; no R2 public endpoint |
| Session | Open the synthetic record and download candidate for inspection. In a second admin tab visit `/cdn-cgi/access/logout`, leaving the record tab open. In the original tab click Start review | Capture real denial/redirect as observed, unchanged D1 version/audits, recovery banner. Use Open sign-in in a new tab → approved email/PIN → Retry session in original tab → Start review again. Do not record authentication screens. If logout is ineffective, stop this case as unverified; do not change Access policy/session duration |
| Approve | Inspect PDF and metadata; tick review confirmation → Approve selected candidate | Actual approval audit and snapshot; student directory reload → course card visible; anonymous GET/HEAD 200, safe UUID filename, no-store, PDF SHA256 matches exactly |
| Withdraw | Admin → Unpublish for re-review; reason `Synthetic acceptance withdrawal` | D1 unpublished; fresh catalog omits UUID and fresh same-URL GET/HEAD 404; exact private file still present/hash matches |
| Pause/end | Redeploy backend paused; if still within window, another explicit UI submit of same synthetic draft/file | `/submit` 503 with no new rows/objects; otherwise initial paused case plus verified paused config closes window without extra request |
| Clean | On exact owned UUID → Permanently remove; reason `Synthetic acceptance cleanup`; bounded manual cleanup only if needed/approved | Identity/title scrubbed, removed tombstone/audits retained, revision deleted, exact R2 key absent, full R2 empty, FK check empty; n=1..3 unchanged, production IDs unchanged |

At each checkpoint record UTC, source SHA, deployment/version, response status,
submission/revision UUIDs, private key, file size/hash, and sanitized D1/R2 query
results with `rows_written=0`. D1 queries select status/version/pointers only;
record identity-presence booleans instead of email/sub or audit actor addresses.
Do not retain raw admin session/detail JSON or screenshots containing identities.
The new UUID/key must be added to a **separate student-run manifest** after 201,
before any deletion; do not change the historical campaign manifest. An ambiguous
response requires read-only discovery of current state before any retry.

## Deferred security decision and release boundaries

**RA-JWT-01: OPEN / UNRESOLVED.** Independent hosted Worker checks for invalid
signature, wrong issuer/audience and expired signed Access JWTs remain
**NOT EXECUTED / NOT PASSED**. Edge-level denial and local signed mocks do not
prove these checks at the hosted Worker. Prior owner acceptance permits isolated
synthetic functional acceptance only. A real logout/expiry case, if successful,
adds session evidence but does not close independent JWT verification. Before
any trusted-contributor pilot, the owner must explicitly accept this remaining
risk for a bounded pilot or complete the tests. No new risk acceptance is inferred
from the revised priority. Genuine nonadmin testing remains conditional on an
available authorized account; never widen the admin policy to manufacture one.

Minimum for a **bounded trusted-contributor pilot**, separately approved after
this run: successful actual UI lifecycle/denials/pause/cleanup evidence; exact
named contributor allowlist and small submission/time limits; one available
moderator; monitored cleanup/retry backlog with an explicit manual cadence or
verified scheduled cleanup before unattended operation; a withdrawal/contact
process and approved contributor permission/privacy wording; an explicit owner
decision on RA-JWT-01 and any unresolved session case. Define pilot upload/byte
budgets and monitoring/stop thresholds, and either verify request throttling or
explicitly accept the small supervised window's capacity risk. No actual
contributors or academic uploads are authorized by this preparation/run.

**Full public launch** additionally needs separate production private D1/R2 and
deployment/Access/cutover approval; legacy upload pause on every old entrypoint;
public frontend cutover with no stale static catalog fallback; disposition of
historical public assets/previews and old credentials; unrestricted-admission
policy replacing this staging account gate; complete hosted auth/session evidence;
appropriate rate limits/quotas, recurring cleanup/recovery/monitoring, and the
deferred deterministic concurrency and focused pagination validation at intended
launch scale. The artificial 200 ms interruption attempt is not a gate. Those
campaigns are not prerequisites for the single student acceptance run.

## Local validation (synthetic services only)

- `node scripts/catalogs.mjs`: 127 courses, zero resources.
- `node --test scripts/*.test.mjs`: 67 tests pass (including the denial helper).
- `npm --prefix worker run check`: types, dry-run bundles, 72 tests pass.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:frontend`:
  39 tests pass, including the generated staging UI with all services mocked
  and the paused setup UI making no Google or submission requests.
- Python `unittest discover` in `scripts/tests` and `analytics/tests`: 3 + 5 pass.
- Both generated deployment configurations pass Wrangler 4.156.0 dry-run using
  explicitly dummy public keys. `pdfinfo` confirms one page, no JavaScript/forms,
  encryption or metadata. `git diff --check` passes.

References: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/),
[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
[deployment secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
