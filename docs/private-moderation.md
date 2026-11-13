# Private moderation migration

Work is on `feat/private-moderation`. This is a staged replacement, not an
approved production cutover. The legacy Worker/configuration, publication App,
required checks and static public catalog remain operational until release.

## Checkpoint verification — 13 November 2026

Milestones A–C have local implementations: private backend/schema/authentication,
moderation and image preparation portal, and disabled public integration. They
still require independent review and live staging acceptance before activation.
The versioned migration exists in source and local emulation only; it has **not**
been applied to the remote staging database. No moderation Worker is deployed.

After the final Access public-key cache change:

- `XDG_CONFIG_HOME=/tmp/root-archive-config WRANGLER_SEND_METRICS=false npm --prefix worker run check`:
  typecheck, both dry-run bundles and **67/67 Worker tests passed**. The auth
  regression verifies repeated requests reuse public keys while expired tokens
  and nonadministrators remain denied. No identity/authorization result is cached.
- The first full rerun hit a local undici `EPIPE` while sending an oversized
  request that the Worker rejected early. That size test now exercises the same
  bounded handler directly in Node with real emulated D1/R2 bindings; the
  413 assertion is unchanged. The full suite then passed. Other lifecycle/auth
  tests still execute in local workerd, with signed external-service fixtures.
- Earlier full Chromium suite: **34/34 passed**, including public navigation,
  disabled/new integration modes, six portal/editor/accessibility checks and
  raster redaction/metadata-removal assertions. External APIs were mocked.
- Checkpoint reruns: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node --test tests/frontend/admin.test.mjs`
  **6/6 passed**; `node --test scripts/*.test.mjs` **33/33 passed**.
- `node scripts/catalogs.mjs`: **127 courses, zero static published resources**.

Generated runtime types, bundles and dependencies remain ignored. Private keys,
JWT literals, GitHub token patterns, temporary logs and debugging code were
checked before committing; font binaries match the existing licensed site fonts.
These are local results, not live Access/Google/Turnstile or CDN verification.

## Architecture

### Independent review fixes (F-01–F-03)

Anonymous GET/HEAD downloads use `resource-<public UUID>.<extension>`, with the
extension selected from a trusted MIME mapping. Original/replacement filenames
remain available only on authenticated administrator routes; public responses
do not forward stored R2 metadata.

`0002_catalog_generation.sql` adds one catalog-generation row and triggers on
resource snapshot inserts, updates and deletes. Public cursors are opaque tokens
bound to that generation, page position and course filter. A D1 batch reads each
page and its generation atomically. Changed generations return
`409 {code: "catalog_changed"}`; the public loader discards **all** partial pages
and restarts, up to three attempts. Every successful traversal therefore comes
from a single catalog state, including equal publication timestamps and changes
to previously read pages. Continuous writes can still exhaust those attempts;
the UI then offers retry instead of partial data. No static fallback or frontend
deduplication hides omissions. This keeps the bounded offset query while fixing
its consistency contract; keyset pagination alone would not remove withdrawn
records already collected on earlier pages. The private administrator queue's
pagination is unchanged. Downloads independently check live publication state.

Startup and session recovery share idempotent course initialization. An initial
session/network/course-loading failure can be retried without reloading the
page; later reauthentication leaves initialized options and in-memory drafts
intact. Neither this change nor public pagination relaxes authorization.

The new migration must accompany any later approved deployment. It has been
tested only in local emulation; no remote migration, activation or data change
is part of these fixes. All live-service and production gates below still apply.

Keep Pages and the static course catalog. A separate moderation Worker owns D1
and a **new private R2 bucket**, serves the administrator assets and same-origin
administrator API, and exposes a read-only public catalog and download API.
`admin.rootamman.com` is the intended administrator origin; `api.rootamman.com`
is the intended public API origin after an approved cutover. Staging uses
different names and storage. No private files or administrator assets are placed
in `site/` or GitHub submission PRs.

Access protects the entire administrator hostname. The Worker additionally
verifies its signed Access JWT (issuer, audience, algorithm, expiration), checks
an explicit email allowlist and exact administrator origin, and requires a
same-origin custom header on writes. Static assets pass through that check too.
There is no development authentication bypass. Alternate Worker/preview hosts
are disabled in the new configuration and rejected by application routing.

All files, including approved files, remain private. Public URLs contain only a
stable resource UUID. Every download consults publication state in primary D1
and streams the selected immutable R2 revision. Responses prohibit caching; no
signed object URLs or public R2 endpoints are used. Unpublishing revokes the URL
and keeps files for private review. Permanent removal revokes it and durably
queues deletion. Already downloaded copies cannot be recalled; a download that
started before revocation may finish. Serving each new request through D1/R2
costs more requests and latency than cached public assets, in return for access
revocation. Do not add a cache without revisiting this guarantee.

Metadata/file changes are private candidates. Publishing atomically updates a
separate D1 public snapshot only after R2 confirms the immutable candidate.
Optimistic record versions prevent stale administrator writes. Durable upload
intents and deletion state make interrupted cross-service work recoverable.
The replacement never writes submission PRs or needs a GitHub credential.

## Read-only account observations — 13 November 2026

- Pages `root-archive` serves `site/` from `main`; canonical deployment SHA is
  `4bb136b9a39423737be4ee30ba1239d735e221c9`. Its catalog is empty, as is current
  `main`'s `site/resources.json`. This is source/deployment provenance, not an
  authenticated live contribution test.
- Legacy Worker `root-archive-worker` is a dashboard deployment with compatibility
  date `2025-02-01`. Its workers.dev and version previews are enabled. Its
  production bindings still use public `root-archive-assets` and GitHub.
- That legacy bucket has enabled r2.dev and `assets.rootamman.com` endpoints and
  four historical objects. None were downloaded, changed or deleted.
- Pages has 44 deployments, including 32 previews and eight successful historical
  submission previews. Current submission-branch exclusions do not revoke old
  previews. Historical links require a separate owner-approved disposition.
- Access apps/organization reads return `access.api.error.not_enabled`.
  Enabling Zero Trust, choosing a team and identity method, setting administrator
  addresses and policies are owner actions. Cloudflare's setup documentation
  requires plan selection/payment details even for its Free option. No plan or
  Access policy was enabled here. Account billing APIs are unavailable to the
  OAuth connection, so no paid entitlement is assumed.

## Isolated infrastructure prepared

Account `1b409400fea16e7142f62ac19ecd361d`:

| Resource | Name / identifier | Status |
| --- | --- | --- |
| D1 | `root-archive-moderation-staging`, `f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6` | EEUR; read replication disabled |
| R2 | `root-archive-private-staging` | EEUR Standard; r2.dev disabled; no custom domains |

Creation did not subscribe to a paid plan, deploy a Worker, add routing/DNS,
change Access, or touch production. Empty staging resources fit documented Free
allowances (D1 10 databases, 5 GB total; Standard R2 10 GB-month). Usage quotas
are account-wide, and future storage/traffic must be monitored by the owner.

See [Cloudflare Zero Trust setup](https://developers.cloudflare.com/cloudflare-one/setup/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/), and
[Worker-first assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

## Repository visibility recommendation

Keep `omatek/root-archive` public through this migration. Administrator security
does not depend on source privacy. After private moderation, privacy provides
limited security value while reducing community transparency and introducing a
plan dependency. Visibility was not changed.

The repository belongs to a **personal** account. Its actual billing plan could
not be read through the available connection. GitHub Free supports repository
rulesets for public repositories; a private personal repository needs **Pro**
for these protections. If the account already has Pro (including an eligible
benefit), no extra subscription may be necessary. Confirm before changing.

Observed active ruleset `26518493` has no bypasses, requires PRs (zero approvals),
resolved threads, up-to-date branches and these source-bound checks:

| Check | App integration ID |
| --- | --- |
| Submission policy | 5734145 (`root-archive-publication`) |
| Repository / Worker / Frontend browser checks | 15368 (GitHub Actions) |
| Cloudflare Pages | 85455 |

The App is issuing checks. This does not verify environment secret restrictions
or hostile-workflow enforcement; those settings were inaccessible. The legacy
branch-protection endpoint returned an integration-permission 403.

Actions and installed Apps support private repositories, subject to installation
access and private CI budgets. Environment branch restrictions would also need
the appropriate private-repository plan. Cloudflare Pages supports private GitHub
repositories; no Cloudflare paid plan is inherently necessary for that switch.
Verify a nonproduction build after any future approved visibility change.

No public forks or releases were observed. Four sampled CI runs contained no
uploaded artifacts; exhaustive artifacts and account billing were inaccessible.
Previously obtained clones, downloads, old public R2 URLs, Pages previews and
deployed browser source remain independent of repository visibility. Closing a
PR or making the repository private is not a content takedown. Public browsing
reads Pages catalogs rather than raw GitHub; the footer source link is the main
public-source dependency. The old Worker already authenticates its GitHub calls.

Sources: [repository](https://api.github.com/repos/omatek/root-archive),
[ruleset](https://github.com/omatek/root-archive/rules/26518493),
[ruleset plans](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[environment availability](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[Pages integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/),
[visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

## Local development and administrator setup

Use Node 24 and the existing lockfiles. Commands below run from the repository
root. `wrangler.moderation.jsonc` targets **staging**, has no routes, disables
workers.dev/version previews, and leaves Access configuration empty. It is not
a production deployment configuration.

```sh
npm ci --prefix worker
npm ci --ignore-scripts
npm --prefix worker run check
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:frontend
npm --prefix worker run db:moderation:local
npm --prefix worker run dev:moderation
```

The browser path is specific to the managed development environment; elsewhere
install Chromium using the project's Playwright version. If the environment's
default user directories are unwritable, use `npm --cache /tmp/root-archive-npm`
and `XDG_CONFIG_HOME=/tmp/root-archive-config` for Wrangler. Generated runtime
types and local D1/R2 state are under ignored `.wrangler/`; no Node compatibility
flag or extra runtime dependency is required.

The new Worker uses compatibility date `2026-10-30`, the maximum supported by
the repository's pinned workerd. It is tested at that date; changing to a newer
date requires an intentional toolchain update and runtime verification.

The portal cannot be used locally by turning off authentication. Automated tests
use synthetic, signed Access/Google JWTs and mocked JWKS/Turnstile inside local
workerd. For real interactive testing, the owner must first configure an isolated
Access application and authorized staging hostnames. Do not point development
bindings at production.

Owner configuration required before a real administrator can sign in:

1. Enable Zero Trust on the existing account, choose an available suitable plan
   and team name, and configure an identity provider. Do not buy or upgrade a
   plan automatically. Confirm current seat limits and existing billing.
2. Create a self-hosted Access application covering **the entire administrator
   hostname**, with a short session duration and an Allow policy listing the
   actual approved administrator addresses. No wildcard student-domain policy,
   Everyone/BYPASS policy or service-token shortcut. Prefer MFA through the IdP.
3. Set server variables `ACCESS_ISSUER=https://<actual-team>.cloudflareaccess.com`,
   `ACCESS_AUD=<actual-application-audience>`, and `ADMIN_EMAILS=<comma-separated
   approved addresses>`. No addresses have been invented or inferred from the
   connected account. Keep the Access policy and application allowlist aligned.
   Store real addresses in protected deployment settings or a secret binding,
   removing the empty placeholder variable from the release configuration when
   using a secret. Never commit an actual administrator allowlist.
4. Set distinct exact HTTPS `ADMIN_ORIGIN` and `PUBLIC_API_ORIGIN`, the explicit
   Pages origin(s) in `ALLOWED_ORIGIN`, and existing Google client ID. Store
   `TURNSTILE_SECRET` as a Worker secret, never a frontend setting. Configure
   the matching Google authorized JS origins and Turnstile hostnames for staging.
5. Route administrator frontend **and** `/admin/api/*` to this same Worker.
   Keep `assets.run_worker_first=true`, `workers_dev=false` and
   `preview_urls=false`. The public API hostname must never serve administrator
   files. No credentialed cross-origin administrator API is used.

API mutations use record versions. A stale edit returns 409 and must be reconciled
against a refreshed record; it must not silently overwrite another moderator.
Authentication expiry requires Access sign-in again. The portal keeps unsaved
form/file work in the current tab and does not persist private documents in
browser storage.

## File preparation and retention

The portal inspects raster images in an authenticated blob preview. Its canvas
editor rotates, crops/removes margins, adjusts brightness/contrast, converts to
grayscale or black-and-white scan style, and replaces redacted pixels with opaque
black **after** all adjustments. Export creates a new PNG and strips source
metadata. Administrators must inspect that final preview before saving a new
private candidate. Changing crop/rotation clears redactions and requires renewed
inspection. Pixel/dimension limits protect browser memory.

Perspective correction, deskew, image-to-PDF export and native PDF page editing
are not implemented. PDFs, Office documents and ZIP files are downloaded for
local inspection; the portal does not embed active document content. Sanitize
PDFs with an appropriate local tool, verify text/images and hidden data are
actually removed, and upload the replacement. No PDF overlay is described as
redaction. Replacement supports every currently accepted type: PDF, DOCX, ZIP,
PNG and JPG. Size/extension/MIME/signature validation is shared with submissions.
Signatures are a format check, not a malware scanner or proof of copyright.
No private file is sent to an external conversion or AI service.

R2 revisions are immutable and D1 records an upload intent before any PUT. A
revision is a candidate only after the upload completes. Approving checks its
ETag and size before atomically updating the D1 snapshot. Publication needs no
R2 copy. Original/unused revisions are queued for deletion after publication;
superseded edited drafts are queued after replacement. Re-review retains the
current private file and stable resource ID until a new decision.

Rejection/permanent removal immediately revoke publication, clear contributor
identity/credit and content-bearing metadata, and queue all files for deletion.
Keep concise reasons free of unnecessary personal data. A minimal private record
retains UUID/course/type, decision times, moderator/action/reason and deletion
bookkeeping. Current published resources retain only the chosen file. Pending
and withdrawn records are retained for review; the owner should review these
queues monthly and explicitly reject/remove abandoned material.

Cleanup attempts a bounded batch after relevant moderation actions. Failures
remain in D1 with attempt count, fixed error code and five-minute retry delay.
Interrupted uploads have a one-hour deadline before cleanup, avoiding deletion
while a normal PUT is still running. A bounded R2 inventory sweep revisits
tombstoned revisions to catch a late PUT after an earlier delete. Unknown objects
are held for owner review rather than guessed to be disposable. The portal has
an authorized retry-cleanup action. Before enabling submissions, configure a
scheduled trigger, set `CLEANUP_ENABLED=true`, verify repeated progress and watch
the private retry backlog. There is no public cleanup endpoint.

Deleted-file bytes cannot be restored by rolling back code. D1 Time Travel or
other backups may retain older metadata independently of active-table scrubbing;
the owner must account for backup retention and access when reviewing privacy
wording. Do not export or retain removed content in untracked backups.

## Production cutover — approval required

The following is a release checklist, **not actions performed by this PR**:

1. Review this draft, pass the required checks and independently inspect auth,
   publication and cleanup behavior. Validate the live staging acceptance below.
   Approve the contributor preparation/credit wording after legal/content review;
   root remains independent of AUM and contributor permission is not ownership.
2. Obtain explicit owner approval for the exact production deployment/routing,
   Access policy and submissions activation. Create a separate production D1 and
   private bucket; verify no r2.dev/custom domains. Create a production Wrangler
   configuration with those actual IDs, same asset gate, approved origins and
   secrets. Never reuse staging IDs. Apply versioned migrations with Wrangler.
3. Inventory current `main`, Pages catalog, open historical submission PRs and
   legacy R2 dependencies again. Current zero resources makes a no-content
   cutover possible; if resources appeared, stop and import their approved bytes
   privately with an explicit ID/URL mapping before changing catalog source.
   Do not blindly import pending PR records. Old direct public R2 URLs cannot be
   revoked by D1; retiring those endpoints/objects needs separate owner approval.
4. Deploy the new Worker/Access-protected admin hostname with submissions
   disabled. Disable its alternate public hosts and test them. Configure the
   recurring cleanup trigger and confirm the private bindings. Keep the public
   archive running on its existing source during this stage.
5. In an approved release window, deploy the tested legacy pause with
   `LEGACY_SUBMISSIONS_ENABLED=false` on **all legacy entrypoints**, including
   workers.dev/version previews, and verify no hostname can create PRs or public
   uploads. This switch defaults to preserving the old flow in this PR and does
   nothing to the older deployed implementation until an approved deployment.
   Drain outstanding
   uploads, back up only approved operational metadata as appropriate and change
   the API route to the tested replacement. Publish Pages with
   `CONFIG.privateModeration=true` and `resourcesEndpoint` pointing to the new
   production API `/resources`. The new student endpoint is `/submit`.
   Do not use a static fallback after switching: it could re-list removed items.
   Old frontend tabs targeting `/` receive a safe failure and must reload.
6. Recheck anonymous browsing/download, expired/nonadmin denials, every removal
   URL, CORS, rate limiting on the actual new routes, Google and Turnstile using
   authorized synthetic staging/production checks. Verify no cache rule overrides
   `no-store` for `/resources` or `/download/*`; exclude them from cache-everything
   rules. Enable submissions only after these checks pass and approval covers it.
7. Only after the replacement passes and its production cutover is approved,
   retire the legacy submission PR code/workflow in a follow-up change, remove
   **only** the App-bound Submission policy requirement in coordination with its
   reporter, and revoke the old Worker GitHub token and publication App key/install
   if they have no other use. Keep Repository/Worker/Frontend/Pages checks and
   unrelated branch protections. Review historical PRs/previews individually;
   closing PRs does not delete Git history or R2 copies.

Staging acceptance must use real owner-authorized identities and check anonymous,
eligible/ineligible student and nonadmin cases; wrong/expired Access audience,
alternate domains and session expiry; submit→edit→approve→anonymous download;
rejection→cleanup; replacement with old file preserved until publish;
unpublish→same-URL denial→private correction→same-ID republication; permanent
removal→same-URL denial→verified object deletion and interrupted retry. Record
deployment IDs, migration versions and results without saving tokens or student
content. Local signed fixtures do not establish live Google, Access, Turnstile,
DNS, R2 public-domain policy or CDN behavior.

## Rollback and legacy cleanup

Before activation, rollback means reverting the development release; production
has not changed. After activation, first disable submissions and drain in-flight
work; retain the new download gate and D1 tombstones so revoked URLs stay revoked.
Roll back UI/Worker code only to a version compatible with the current schema.
Do not roll back to a static catalog or the old public upload pipeline after
accepting private submissions. A full legacy return requires a separate reviewed
data/export plan and must preserve all removal decisions. Prefer fixing forward
with submissions temporarily disabled.

Staging resources can be deleted after owner review when testing is finished;
no production resource or historical object is scheduled for deletion here.
For historical public content, inventory exact PR/preview/object dependencies,
obtain owner approval, revoke the relevant public hosts/URLs and purge applicable
managed CDN caches before deleting only the approved objects. Neither changing
repository visibility nor code rollback removes previously public content.
