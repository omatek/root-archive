# Staging execution results — 14 November 2026

## Hosted security resume — latest checkpoint

Resumed exact handoff `1bcce0009c807167a2d4ade4c9845be99f0c8d58` in a
separate worktree. **Group A: INCOMPLETE. Group B: NOT STARTED.** No
migration, deployment, Access change, fixture seed, cleanup or production/legacy
mutation was issued. This run used actual hosted requests, without local tests
or mocked results.

At approximately 09:33–09:34 UTC, 119 live requests covered all ten files under
`admin/`, root/unknown paths, session/courses/list/detail/private-file routes,
all eight mutation routes, GET/HEAD, POST/OPTIONS, forged assertion/email
headers and a deliberately invalid synthetic session cookie. Redirects were
not followed. POST bodies were deliberately invalid JSON so an unexpected
authentication failure could not execute an operation.

- All 49 non-OPTIONS administrator probes returned 302 to the expected Access
  login origin/path. No protected asset, API or private file was returned.
- All 57 corresponding probes on the public API hostname returned the Worker's
  JSON 404, including every asset/admin path and forged-header probe.
- Eight bare administrator OPTIONS requests returned 400 HTML. A subsequent
  browser-style OPTIONS request to `/admin/api/session`, with the administrator
  Origin and preflight method/header fields, returned 403. These are denials;
  they do not establish authorized CORS/session behavior.
- `/resources` returned 200, an empty catalog and `private, no-store, max-age=0`.
  Missing synthetic-ID download GET/HEAD returned 404 with the same cache policy.
  Access JWKS returned 200 and two keys; no assertion was collected.
- HTTPS verification remained enabled: curl returned `ssl_verify_result=0` for
  admin, public API and Access JWKS. The managed proxy presents its own OpenAI
  certificate, including the requested admin SAN. Cloudflare's read-only API
  separately reports both recorded custom-domain certificate packs active,
  exact hostname coverage, Google Trust Services issuance and expiry on
  12 February 2027. **The actual edge certificate chain/SANs were not observed
  directly through this intercepting proxy; that portion of the TLS gate remains
  unverified.**
- workers.dev `/` failed at proxy CONNECT with 403; it did not reach the origin.
  The updated environment permits the three custom/Access hosts, but lacks
  moderation workers.dev/version-host grants. This is not an alternate-host pass.
  API inventory still shows workers.dev and previews disabled and both custom
  domains' preview routing false. The sole version has `has_preview=true` metadata;
  no preview was created or enabled, and no actual preview-host denial is claimed.
- Read-only inventory confirms the original deployment/version and staging-only
  bindings, secret ADMIN_EMAILS binding, correct issuer/AUD/origins, disabled
  submissions/cleanup, private R2 domains disabled/absent, and one exact-email
  Access Allow policy with the existing PIN provider and no overlapping app.
  This checks configuration, not genuine administrator login or JWT execution.

Evidence: [hosted probes](staging-hosted-security-evidence.json) and
[sanitized read-only inventory](staging-hosted-security-inventory.json).
No cookies, OTPs, assertions, actual administrator email or response content
from protected pages were retained. The configured Cloudflare API secret was
not sent to staging. The original workspace checkout was preserved.

**Stop for real administrator interaction:** open
`https://admin.archive.rootamman.com/`, enter the existing approved Proton
administrator address, request the email code and enter it in the Cloudflare
Access page. Confirm the portal loads, then visit
`https://admin.archive.rootamman.com/admin/api/session` in the same browser and
confirm a successful JSON session response. Never paste the PIN, cookies or JWT
into chat. An owner-browser success alone does not create a session in the
Codex browser; subsequent authenticated acceptance needs that same real session
in the browser used for testing.

Administrator login, genuine expired/revoked-session checks, independent hosted
Worker JWT/allowlist enforcement, direct edge TLS inspection and workers.dev/
version-host probes remain outstanding. Access interception of forged assertions
does not prove that the Worker's independent validator ran. Do not weaken Access,
change the allowlist, deploy a diagnostic endpoint or seed fixtures to complete
these gates. Grant the existing moderation workers.dev/version hostnames under
`omar-khldooon33.workers.dev` in the environment for remaining alternate-host
probes. Group B stays blocked until every Group A gate is evidenced as passed.

## Wrangler deployment — current checkpoint

Continued from `048b998102279d1945870ad5a1226c502ea34841` using the owner's
explicit authorization to split Access verification from deployment credentials.
The earlier policy-read 403 is a deployment-token scope limitation, not a failed
security control. The connected Cloudflare integration independently verified
app `bebba566-18d3-42c5-a78e-50213ea2dad6`, unchanged AUD, existing single exact-email
Allow policy, PIN provider `0db90b4d-534a-4f75-ab0e-026016e0b1b9`, one-hour session,
HttpOnly/binding cookies, no preflight bypass and no overlapping Access apps.
No Access setting was changed. The exact existing policy email was transferred
in encrypted form and supplied only through a mode-0600 temporary secrets file;
that file and the temporary transfer key were removed after deployment.

Preflight confirmed both migrations recorded, zero submissions/revisions/resources/
audit rows, clean foreign keys, empty private R2, disabled r2.dev and no R2 custom
domains. Reviewed implementation/config/assets still match `5f978552…` exactly.
No migration was reapplied. Locked dependencies were restored with `npm ci`;
Wrangler 4.156.0 release-config dry-run and real deploy succeeded.

At `2026-11-14T08:32:53Z`, Wrangler uploaded all ten administrator assets and deployed:

- Worker `root-archive-moderation-staging`.
- Version `bb9e96b3-e789-47b0-aa92-16168fe80db4` at 100%; deployment
  `2eaa7db3-f51c-4747-a5ea-e8ec0b86c5a2`.
- Admin custom domain `580d38dcab623f69bd2edffa224340c4473435be`, managed DNS
  `60487f52f1b055e739042149d60f8e45`, certificate reference
  `ec66ad67-c346-4ff5-a5b1-dc3d59735aa9`.
- API-staging custom domain `1fc544a0ed42618cfdde24bc360c4686a50675a8`, managed DNS
  `6b07023fca7347ba5d83c67fda5322a4`, certificate reference
  `2cdcbcd6-7862-46f9-bb0c-1e3ea3b30642`.

Postflight confirms only staging D1 `f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6`,
R2 `root-archive-private-staging` and ASSETS bindings, ADMIN_EMAILS as a secret,
correct issuer/AUD/origins, and submissions/cleanup false. workers.dev and version
previews are disabled; both custom domains have preview routing false. R2 remains
empty. Legacy deployment/version, production Pages canonical deployment/SHA and
three existing production DNS records remain unchanged. No legacy/public R2,
production DNS or Pages mutation was issued.

**Group A remains BLOCKED at hosted verification; Group B has NOT STARTED.**
Cloud-shell HTTPS probes fail before reaching the origin: curl exit 56,
`CONNECT tunnel failed, response 403`, HTTP `000`. The integration's generic fetch
also denies the new hostnames; a control `/resources` request returns
`Forbidden: requests to api-staging.rootamman.com are not allowed`. These are
network-policy limitations, not evidence of Access denial or a security failure.
Do not count the attempted admin HTML/asset/API probes as passed security tests.
Certificate references and routing creation do not prove valid hosted TLS.
The zone certificate-pack listing has not yet exposed the new certificates.

The running environment needs HTTPS access to `admin.archive.rootamman.com`,
`api-staging.rootamman.com`, `rootamman.cloudflareaccess.com`, and the exact
moderation workers.dev/version hosts under `omar-khldooon33.workers.dev` for the
required probes. No environment-change tool is offered; edit the running
machine's network settings. Then complete anonymous/forged-token/alternate-host
checks, actual TLS verification and owner-operated email-PIN login. Independent
hosted JWT/allowlist enforcement and session-negative cases remain unverified.
No authentication bypass or synthetic writes are authorized before that gate.

[Sanitized deployment evidence](staging-wrangler-deployment-evidence.json) records
bindings, domain/DNS/certificate identities and unchanged production checkpoints.
The original rollback plan now applies to the two recorded new custom-domain IDs;
no rollback was performed. Access PIN configuration is retained. PR #26 stays
draft/unmerged and public integration remains disabled.

## Authenticated Wrangler resume — current checkpoint

Resumed the existing owner-approved Groups A/B in a newly selected Codex Cloud
environment on 14 November 2026 UTC. This supersedes the earlier assertion that
no authenticated Wrangler environment is available. **Wrangler authentication:
PASS. Group A: BLOCKED by token permissions. Group B: NOT STARTED.**

- Fetched `feat/private-moderation` and checked out exact checkpoint
  `3c72dc82ae1c45c6b5e35631766eb76e56a6f989` with a clean working tree.
  GitHub confirms PR #26 is open, draft and unmerged at that head.
- Read the current deployment plan, execution results, private moderation guide
  and moderation Wrangler configuration. `git diff --exit-code
  5f978552dc5a8ed0b515386b6a20bc8e3dcb00d0 -- worker admin site scripts tests
  package.json package-lock.json` passed. Both migration SHA256 values match
  the approved plan. No implementation, asset, dependency or configuration
  change was needed.
- Node `v24.22.1`; installed existing locked Worker dependencies with
  `npm ci --prefix worker --cache /tmp/root-archive-npm` (42 packages).
  Local Wrangler `4.156.0` help confirms the planned deploy and secrets-file
  options. No migration command was run.
- `XDG_CONFIG_HOME=/tmp/root-archive-config WRANGLER_SEND_METRICS=false
  worker/node_modules/.bin/wrangler whoami` exited 0 and reported User API Token
  authentication through the configured `CLOUDFLARE_API_TOKEN` environment
  secret, with expected account `1b409400fea16e7142f62ac19ecd361d` listed.
  No credential or token value was displayed or saved in evidence.
- The first remote preflight request, authenticated using that same configured
  secret, was `GET /accounts/1b409400fea16e7142f62ac19ecd361d/access/policies/
  1fd4e71c-8a76-4969-8792-2772531ca2a9` (one continuous API path). Cloudflare
  returned **HTTP 403**, error code **1010**, `auth.forbidden`. This blocks
  revalidating the existing exact-email policy and securely deriving the
  matching Worker allowlist. It is not an asset-session upload failure.
- Stopped immediately under the owner's instruction to stop on insufficient
  permissions. No later inventory request, protected allowlist file creation,
  deploy, migration, asset upload, DNS/TLS mutation or hosted test occurred.
  Worker/custom-domain deployment permissions have not been exercised.

[Sanitized resume evidence](staging-wrangler-resume-evidence.json) records the
exact blocker. Repair the environment token's access to the existing account:
the reusable-policy GET accepts **Access: Apps and Policies Read** (or Write).
Use secure environment-secret configuration; never paste a token into chat.
The remaining inventory/deployment operations may require other permissions;
this run does not claim they have been validated. No connector fallback or
repeat upload investigation was attempted.

All hosted Group A gates remain unverified in this run: actual owner PIN login,
anonymous asset/API denials, independent JWT/allowlist enforcement, alternate
endpoint protection, deployed staging bindings and valid HTTPS. No PIN
interaction is needed until the portal is deployed. Group B has no fixture
writes or deletions. The previously recorded applied migrations and empty
staging storage were preserved by issuing no writes; their remote state was
not re-read after the permission failure. No production/legacy mutation was
issued, and their current remote identifiers were not revalidated in this run.
Access policy, email-PIN provider and AUD were not modified; submissions,
scheduled cleanup and public integration remain disabled in source.

## Direct-upload diagnosis — latest checkpoint

Continued from `c967e007691d4ce1cc2e35c89fd015f7af4bd21e` under the
owner's instruction to diagnose the protocol and retain email-PIN authentication.
No D1 migration was reapplied. Source, config and assets still match reviewed
`5f978552dc5a8ed0b515386b6a20bc8e3dcb00d0`; tested bundle SHA256 is unchanged.

Compared the actual previous construction with
[Cloudflare's official direct-upload protocol](https://developers.cloudflare.com/workers/static-assets/direct-upload/)
and installed Wrangler 4.156.0's asset uploader:

1. Manifest registration used the existing account and approved staging Worker
   name, with the same ten verified asset hashes/sizes. Fresh registration
   returned a three-segment session token and three buckets requesting ten files.
2. The fresh transfer request used that returned session token as the bearer
   credential, rather than the ordinary account API credential. The constructed
   Request's authorization value was compared in memory with the session token;
   only the boolean result was returned. This checks construction, not wire-level
   forwarding. No bearer token, secret or complete header was printed or saved.
3. Endpoint/method were the documented POST to
   `/accounts/1b409400fea16e7142f62ac19ecd361d/workers/assets/upload?base64=true`.
   Redirect following was disabled for diagnosis; no redirect occurred.
4. Multipart body was constructed with FormData/Blob, hash-named file fields,
   base64-encoded file bytes, and matching per-part MIME types. A cloned Request
   was parsed back into FormData: expected fields, MIME types and lengths all
   passed, and the multipart boundary was present. Source bytes/hashes were
   rechecked locally against the previously verified artifact payload.
5. The fresh token's decoded expiry was 3,599 seconds in the future, and its
   single-asset-upload flag was false. Thus the bulk protocol and immediate use
   matched this session; ordinary expiration and an accidentally selected
   single-asset protocol do not explain this fresh failure. Decoding claims is
   diagnostic only and does not establish the token's cryptographic validity.
6. The first requested bucket returned **HTTP 401**, content type
   `text/plain;charset=UTF-8`, exact body `Unauthorized`, server `cloudflare`,
   Ray ID `a5a45c2ee8a9355d-WAW`. No uploads were acknowledged. Execution did not
   proceed to other buckets and no completion token was received or substituted
   with the initial session token. No Worker attachment/deployment was attempted.

Read-only controls: connected domain reads succeeded; generic fetch without an
explicit Authorization header returned successful JSON; a deliberately invalid
synthetic credential returned JSON HTTP 400/code 9106. This demonstrates that an
explicit header affects processing, but **does not prove** a real session JWT
arrived unchanged at the asset service. A second registration inspected token
shape only (no transfer): three segments and a non-placeholder 86-character
signature component. Its header/expiry metadata could not be decoded by that
diagnostic helper; it provides no proof of token validity or redaction.

**Confirmed result, unresolved cause:** a fresh bulk asset transfer constructed
according to the documented protocol is rejected with 401. Available evidence
cannot distinguish connector transport/authorization handling from Cloudflare
session-token validation. It does not establish insufficient account scopes,
header stripping, payload corruption or a server-side defect. The supported
`cloudflare.request` interface has no Authorization-header override; the generic
fetch path permits construction but this upload authentication could not be
completed or verified. No unsupported credential workaround was attempted.

[Sanitized diagnostics](staging-upload-diagnostics.json) contain the observations,
not tokens or complete headers. These diagnostic registrations may leave
transient manifest/session state, but no asset transfer was acknowledged. No
cleanup/deletion was attempted. Read-only postflight again shows only the legacy
Worker and existing domain, unchanged legacy deployment/ETag and production Pages
deployment, and an empty staging R2 bucket. Existing D1 ledger remains 0001/0002;
application counts are zero. No Access, authentication-choice, DNS, TLS, Worker,
R2 object or production mutation was made in this diagnostic continuation.

Group A is still partially completed and blocked; all hosted security gates
remain unverified. Group B has not started. Wrangler `whoami` still reports
unauthenticated and no `CLOUDFLARE_API_TOKEN` environment secret is configured,
so there is no authenticated Wrangler fallback available in this environment.

Recommended next step: make an authorized Wrangler environment available through
a secure environment-secret or supported OAuth-login mechanism, then resume the
same approved deployment without reapplying migrations. Never paste token values
in chat. Alternatively the integration provider must resolve/confirm its
session-JWT upload support before another connector transfer is attempted.
No administrator PIN interaction is needed until the portal is deployed.

## API deployment attempt — latest result

This supersedes the earlier CLI-authentication stop recorded below. The owner
explicitly authorized replacing Wrangler execution with connected Cloudflare API
operations while preserving source, SQL, resources and the security gate.

- Source/configuration/admin assets match reviewed commit
  `5f978552dc5a8ed0b515386b6a20bc8e3dcb00d0`. The current checkout differs from
  that commit only in documentation/instructions. Worker typecheck, dry-run
  bundles and 71/71 local Worker tests passed before remote writes.
- Verified tested bundle SHA256:
  `080ac6521a239d769ed02ec2c0aab9f39feb80e23b307a798ff43fa9fd4747fd`.
  Ten admin asset files were hashed with SHA256 and the installed Wrangler's
  BLAKE3 asset-manifest algorithm. All bytes were rechecked inside the API
  execution runtime before upload. No source/security change was made.
- Pre-migration Time Travel bookmark:
  `0000000a-00000000-00005123-85f5d60047382e3f32e50ee33f993a02`.
- **Migration 0001 succeeded at 03:48:56 UTC; 0002 at 03:49:12 UTC.** Exact
  reviewed SQL was sent in order to staging D1
  `f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6`, with the compatible `d1_migrations`
  schema and each filename inserted after its migration. Ledger IDs are 1/2.
  All six application tables, indexes and three catalog triggers exist;
  foreign-key check is clean. Only cleanup/catalog singleton rows are present.
  Submissions, revisions, resources and audit tables each contain zero records.
- The asset-upload session registration succeeded for
  `root-archive-moderation-staging`. The first transfer using its upload-session
  bearer token returned non-JSON text beginning **Unauthorized**; JSON parsing
  failed. Zero asset uploads were acknowledged. The response HTTP status was not
  retained, so this report does not invent a status code or assert the root
  cause is a particular missing scope. Token-based asset transfer is blocked.
- Execution stopped immediately: no retry, credential substitution, alternate
  infrastructure, code upload, endpoint/domain change or TLS configuration.
  The session token was neither returned nor saved in logs/evidence; registration
  may leave transient manifest/session state. No cleanup/delete was attempted.

[Sanitized API deployment evidence](staging-api-deployment-evidence.json)
records the artifact manifest, migration checks and postflight inventory at
`2026-11-14T03:50:57.966Z`. Only legacy `root-archive-worker` is listed; no
moderation Worker/version/deployment ID exists. Existing production DNS/custom
domain, Worker ETag/deployment, and canonical Pages deployment still match the
baseline. R2 is empty; its contents were not modified. Access app, AUD, OTP
provider and exact-email policy were unchanged by this attempt. No unexpected
deletion or production mutation occurred.

**Group A remains incomplete. Group B did not start.** Hosted administrator
login, unauthorized-request denial, independent JWT/allowlist enforcement,
alternate-host rejection, TLS and deployed binding inspection remain blocked.
No synthetic test records/files were seeded or deleted. No real identities or
academic materials were used. Submissions and scheduled cleanup were not enabled.

Next action: resolve authorization of the documented asset-session upload flow
in the connected integration, or use an authenticated Wrangler environment for
the same approved account/resources. Do not recreate resources, rerun applied
migrations or change authentication to get a pass. A genuine owner PIN login
and every remaining Group A security check are still required before Group B.

Recovery: no code/domain rollback is necessary because no Worker or hostname
was deployed. Prefer retaining the compatible staging schema/ledger and fixing
forward. D1 Time Travel restoration to the bookmark above remains a separate
explicitly approved destructive recovery choice; no restore was performed.
No asset, R2 object, historical preview or legacy resource deletion is authorized
by this failed attempt.

## Earlier email-PIN setup — historical checkpoint

Approved deployment source: `5f978552dc5a8ed0b515386b6a20bc8e3dcb00d0`,
branch `feat/private-moderation`, draft [PR #26](https://github.com/omatek/root-archive/pull/26).
The owner approved Groups A/B in the [execution plan](staging-deployment.md),
with a mandatory successful hosted security gate before B. Approval persists;
this report does not request another approval for the same operations.

## Group A — partially executed, blocked

Cloudflare account `1b409400fea16e7142f62ac19ecd361d`.
Two remote mutations succeeded through the connected Cloudflare API:

1. Created `Archive staging email PIN`, type `onetimepin`, ID
   `0db90b4d-534a-4f75-ab0e-026016e0b1b9`, config `{}`.
2. Updated existing app `admin.archive`, ID
   `bebba566-18d3-42c5-a78e-50213ea2dad6`, at `2026-11-14T01:25:42Z`:
   allowed IdPs now contain only that PIN provider; session duration `1h`;
   HttpOnly cookie and binding cookie enabled. Preserved entire protected
   hostname, destinations, no OPTIONS bypass, and the existing reusable policy.

The application AUD remains
`0003d8d8ba905005bfed05fc441631de07c91985c3e2baab528bdb4bbb7ac5be`.
Reusable policy `1fd4e71c-8a76-4969-8792-2772531ca2a9` still allows exactly
the same single administrator email; its update timestamp remains
`2026-11-13T23:30:28Z`. No policy, existing Cloudflare IdP, account membership,
or production setting was modified. The administrator email is omitted from
committed evidence. No OTP request, code, cookie or JWT was collected.

Wrangler 4.156.0 `whoami`, with the planned config-home setting, reported
**You are not authenticated**. The approved plan explicitly requires CLI
authentication before migrations/deployment. No temporary account, credential
extraction, substitute migration ledger, auth bypass or alternative deployment
was used. Required CLI operations are blocked; no remote migration or Worker
deployment command was attempted.

Post-change API verification at `2026-11-14T01:26:13.895Z` is recorded in
[sanitized evidence](staging-group-a-evidence.json):

- Staging D1 `f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6` still contains only
  internal `_cf_KV`; no migrations or application tables. The read-only schema
  query reports `changed_db=false`, `rows_written=0`, size 12,288 bytes.
- Private staging R2 `root-archive-private-staging`, ID
  `1a5f949cc506496daa0ff5ff43333c72`, remains empty. Preflight reconfirmed
  r2.dev disabled and no custom domains. No object writes/deletions occurred.
- `root-archive-moderation-staging` does not exist. No staging Worker version,
  deployment, domain, DNS or certificate identifiers were created.
- Admin hostname DNS resolution still fails; no TLS or hosted login success
  is claimed. The API accepts the PIN configuration, but that does not prove
  mail delivery, owner authentication or enforcement at the hosted Worker.

## Mandatory security gate

| Requirement | Result |
| --- | --- |
| Authorized administrator genuinely authenticates | Blocked: hostname/Worker not deployed; no OTP login exercised |
| Unauthorized admin assets/APIs denied | Hosted verification unavailable |
| Worker independently validates JWT and administrator allowlist | Source/local tests previously passed; deployed verification unavailable |
| Alternate endpoints cannot bypass protection | Source disables/rejects them; hosted verification unavailable |
| Deployed bindings use only approved staging D1/R2 | No deployed moderation bindings exist to inspect |
| Production/legacy unchanged | Existing deployment/version, Worker ETag, custom domain, DNS and production Pages identifiers match baseline |

The gate has **not passed**. Missing verification is not treated as success.
Previously recorded 71 Worker/37 browser tests are local mocked/emulated evidence,
not results of this execution. No new hosted lifecycle test passed here.

## Group B — not started

No synthetic records were seeded, published, withdrawn, edited or deleted.
No concurrency/failure-recovery/deletion campaign was run. No real students or
academic materials were used. Audit/recovery data was not created or removed.
The local synthetic manifest prepared earlier remains local and unexecuted.
Submissions, scheduled cleanup and production frontend integration remain off.

## Production baseline retained

- Legacy Worker deployment `88fef60a-22b0-434a-bbc2-89ac0d569629`, active version
  `e8895ac0-b95b-409e-aff1-af3f549be94f`, modification time
  `2026-11-12T19:55:21.827727Z`; unchanged ETag in JSON evidence.
- Existing `api.rootamman.com` domain ID
  `18ff115e80d1e21d3b74e146d72bf141227e6f23`, mapped to the legacy Worker.
- Existing DNS IDs, targets and modification times for API, archive and assets
  match preflight; no staging hostname records were created.
- Production Pages canonical deployment
  `60b32faf-7934-4e5b-8a34-c07c1cb0983d`, SHA
  `4bb136b9a39423737be4ee30ba1239d735e221c9`, branch `main` unchanged.

No production/legacy mutation API was issued, historical previews were not
deleted, PR #26 was not merged, and no paid subscription was introduced.

## Resume and recovery

Resume requires an authenticated authorized Wrangler execution environment for
the existing account. Do not paste credentials into chat. Re-read the inventory,
recognize the two intentional Access changes above, and use the originally
approved source SHA for migration/deployment. Complete the remaining Group A
steps and genuinely verify owner PIN login and every security requirement before
any Group B write. No deployment permission renewal is needed for unchanged scope.

No rollback has been performed; the approved PIN configuration remains in place.
If rolling it back under the approved recovery plan, while the hostname remains
unrouted, PUT the app's saved writable settings with the same domain,
destinations and policy reference, restoring `allowed_idps=[]`, session `24h`,
HttpOnly false and binding cookie false; preserve all other settings. Verify
no application references the new provider, then DELETE only
`/accounts/1b409400fea16e7142f62ac19ecd361d/access/identity_providers/0db90b4d-534a-4f75-ab0e-026016e0b1b9`.
No D1, R2, Worker, DNS or certificate recovery is needed because none was changed.
