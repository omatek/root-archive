# Isolated moderation staging — approval required

## Current owner authorization — synthetic functional acceptance

The owner explicitly accepts deferring the unverified hosted independent JWT
rejection and expired/revoked-session negative tests **only for isolated,
synthetic-only staging functional acceptance**. Group A is not fully passed.
This supersedes the earlier instruction to wait for every hosted security case
before Group B. Access and independent Worker authorization remain unchanged.
Begin with one reserved lifecycle fixture before scaling the existing campaign;
the identifiers, limits, private staging bindings and deletion boundaries below
still apply. No production activation or real academic upload is authorized.
See the current execution results for completed operations and remaining actions.

Verified 14 November 2026 (Asia/Amman; Cloudflare observations began on
13 November UTC). This plan does **not** authorize remote execution. Stop before
any migration, deployment, Access/DNS/routing change or persistent staging write.
Approval must identify the pushed commit and operation groups below. A choice
of login method is not deployment approval.

## Verified state

- PR [#26](https://github.com/omatek/root-archive/pull/26) is open and draft.
  Its initial head exactly matched independently reviewed
  `ea29b7cfd3d9fa6156f06c3ae684038c4a16bc9d`; there are no GitHub review
  submissions. The independent review is an owner-supplied checkpoint.
- Main ruleset `26518493` requires Repository checks, Worker checks and Frontend
  browser checks from integration `15368`, Cloudflare Pages from `85455`, and
  Submission policy from `5734145`. All five passed at the initial head.
  Strict status checks, PRs and resolved review threads are required; no bypass
  actors. Required approving review count is zero. Legacy branch-protection
  API reads returned 403; the ruleset API provided the requirements above.
- Account: `1b409400fea16e7142f62ac19ecd361d`.
  Zone: `rootamman.com`, `fc80d6a45a703d0fe4d1876f1380870f`, active full zone,
  Free Website. Zero Trust Free is owner-confirmed; billing/subscription API
  reads are unsupported by this OAuth connection, so no additional entitlement
  or spending authority is assumed.

| Object | Exact identity | Observed state |
| --- | --- | --- |
| Access organization | `rootamman.cloudflareaccess.com` | Enabled |
| Access app | `admin.archive`, `bebba566-18d3-42c5-a78e-50213ea2dad6` | Self-hosted; entire `admin.archive.rootamman.com`; no path restriction |
| App AUD | `0003d8d8ba905005bfed05fc441631de07c91985c3e2baab528bdb4bbb7ac5be` | Verified from app API |
| Reusable policy | `Archive Administrators`, `1fd4e71c-8a76-4969-8792-2772531ca2a9` | One exact email; Allow; no Everyone, bypass or service-token rule |
| Existing IdP | `5fa52c35-ad8a-45ae-8d02-b3383047ee85` | Cloudflare login, `restrict_to_account_members=true` |
| D1 / `DB` | `root-archive-moderation-staging`, `f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6` | EEUR, read replication disabled, 12,288 bytes, zero application tables |
| R2 / `PRIVATE_FILES` | `root-archive-private-staging`, bucket ID `1a5f949cc506496daa0ff5ff43333c72` | EEUR Standard; empty object listing; r2.dev disabled; zero custom domains |
| Proposed Worker | `root-archive-moderation-staging` | Absent; no deployment/version ID exists yet |

D1 read-only `SELECT type,name,sql FROM sqlite_schema ORDER BY type,name`
returned only internal `_cf_KV`; `changed_db=false`, `rows_written=0`.
No migration ledger, moderation tables, triggers or application records exist.
R2 CORS is absent (404); lifecycle contains only the default seven-day incomplete
multipart abort rule, with no object expiration rule. The configured preview
bucket did not exist and its binding has been removed. Local tests use emulation.

The only deployed Worker is legacy `root-archive-worker`, compatibility date
`2025-02-01`, bound to public `root-archive-assets`, Google and GitHub. Its active
deployment is `88fef60a-22b0-434a-bbc2-89ac0d569629`, version
`e8895ac0-b95b-409e-aff1-af3f549be94f`. workers.dev and version previews are
enabled (10 historical versions listed). Its custom domain is
`api.rootamman.com`, domain ID `18ff115e80d1e21d3b74e146d72bf141227e6f23`.
There are no zone Worker routes. These legacy entrypoints are excluded from all
operations below; the new Worker's strict origin gate does not secure the old one.

Pages `root-archive` still serves `site/` from `main`, canonical deployment
`60b32faf-7934-4e5b-8a34-c07c1cb0983d`, SHA
`4bb136b9a39423737be4ee30ba1239d735e221c9`, on `archive.rootamman.com` and
`root-archive.pages.dev`. Submission branches are excluded from new previews;
historical previews remain outside this task. A branch push can trigger the
existing Pages preview/check, but this change contains no public frontend edits.

## Blockers and environment separation

1. The policy email differs from the account's sole accepted member. The only
   IdP cannot currently authenticate the allowed identity. The owner selected
   **plan email one-time PIN, retain the current Proton address**. Neither OTP
   setup nor an actual administrator login has been exercised.
2. No DNS record/custom domain exists for the new admin hostname, and a resolver
   lookup fails. Active certificate packs cover `rootamman.com`,
   `*.rootamman.com`, `api.rootamman.com` and `*.api.rootamman.com` only.
   **None covers `admin.archive.rootamman.com`.** A Worker Custom Domain can
   provision its own certificate for this nested hostname without a separate
   paid Advanced Certificate Manager subscription. Certificate issuance and
   successful hostname-verifying TLS are acceptance gates, not assumed results.
3. Staging API/frontend names have no DNS records. Only `api-staging.rootamman.com`
   will be attached below. `archive-staging.rootamman.com` remains a closed
   submission-origin placeholder; this plan does not deploy a student frontend.
4. The current Turnstile widget covers production frontends only. No staging
   secret or approved synthetic eligible Google identity is available. Google
   authorized origins/consent could not be verified with available tools.
   Real `/submit` acceptance is blocked; seed records are not student uploads.
5. Wrangler 4.156.0 is installed but unauthenticated in this workspace; no
   Cloudflare CLI credential is available. The Cloudflare connector supports
   the verified reads. Before CLI execution, use an authorized operator's
   existing login or appropriately scoped credential. Do not create a temporary
   account, expose tokens, upgrade plans or improvise another deployment target.

`admin.archive.rootamman.com` is reserved for this **isolated staging Worker**
first. It is not an existing production endpoint. Its later use with production
storage requires a separate cutover. No production moderation configuration or
production D1/private R2 has been created. Staging uses a distinct Worker and
existing staging storage; `api.rootamman.com`, `archive.rootamman.com`, legacy
R2 and the production Pages project are excluded from mutations.

The source config pins the exact issuer/AUD, keeps `ADMIN_EMAILS` empty, uses
Worker-first assets, disables workers.dev/previews, has no routes, and leaves
submissions/cleanup false. It is fail-closed until the exact policy email is
supplied as a protected secret. Staging Google client configuration is empty;
no production credential is copied. `CONFIG.privateModeration` stays false.

No cache Page Rules or cache rulesets were listed. Existing header/rate-limit
rules apply to production hosts; the rate-limit scope guard excludes staging.
Do not open staging submissions based on production rate-limit coverage.

## Approval group A — identity and empty staging deployment

Re-read all identities, policy, schema, bucket contents, DNS, certificates and
branch SHA immediately before execution. Stop on drift, unexpected records,
other bindings, overlapping Access apps or conflicting hostnames. Save sanitized
baseline settings, migration hashes and a D1 Time Travel bookmark. Read-only
inventory and local dry-runs need no remote-write approval.

All API paths below use account `1b409400fea16e7142f62ac19ecd361d` unless stated.

1. `POST /accounts/{account}/access/identity_providers` with
   `{"name":"Archive staging email PIN","type":"onetimepin","config":{}}`.
   Record the returned IdP ID; reuse an exact matching provider if one was
   deliberately created in the meantime, after checking drift.
2. `PUT /accounts/{account}/access/apps/bebba566-18d3-42c5-a78e-50213ea2dad6`:
   preserve name `admin.archive`, type `self_hosted`, domain
   `admin.archive.rootamman.com`, destinations
   `[{"type":"public","uri":"admin.archive.rootamman.com"}]`,
   `app_launcher_visible=true`, `auto_redirect_to_identity=false`,
   `options_preflight_bypass=false`, `eager_redirect_cookie_setting=true`;
   set `allowed_idps=[<returned OTP ID>]`, `session_duration="1h"`,
   `http_only_cookie_attribute=true`, `enable_binding_cookie=true`;
   link **the existing reusable policy** with
   `policies=[{"id":"1fd4e71c-8a76-4969-8792-2772531ca2a9","precedence":1}]`.
   Do not change its email/include/require/exclude rules or infer an allowlist
   from the connected account. Verify the hostname and AUD are unchanged.
3. Run the following commands **only after approval and CLI authentication**,
   from the repository root at the approved SHA. Source migration hashes:

   - `0001_private_moderation.sql` SHA256
     `c7d7ec22e7bf186fa21e0049ad0fe58c8352094bb6ef94a33508fee9328b682d`
   - `0002_catalog_generation.sql` SHA256
     `4a3c8d6bd19288c7645bc8c5ebc87e9c340e9f860574b67954080e05d00e4beb`

```sh
export XDG_CONFIG_HOME=/tmp/root-archive-config
export WRANGLER_SEND_METRICS=false
git rev-parse HEAD
git status --short
sha256sum worker/migrations/*.sql
./worker/node_modules/.bin/wrangler d1 time-travel info root-archive-moderation-staging --config worker/wrangler.moderation.jsonc
./worker/node_modules/.bin/wrangler d1 migrations apply root-archive-moderation-staging --remote --config worker/wrangler.moderation.jsonc
./worker/node_modules/.bin/wrangler d1 migrations list root-archive-moderation-staging --remote --config worker/wrangler.moderation.jsonc
```

Expected D1 change: apply both reviewed migrations, create six application
tables (`submissions`, `file_revisions`, `resources`, `moderation_audit`,
`cleanup_state`, `catalog_state`), indexes and three catalog triggers, plus
Wrangler's migration ledger/internal bookkeeping. Only the two singleton state
rows are initialized; no contribution/resource/revision is created. Re-query
`sqlite_schema`, migration ledger, singleton counts, foreign-key check and
application counts. If migration 0002 fails after 0001 succeeds, do not deploy;
record the partial ledger and resolve or restore while unrouted.

4. Prepare a local ignored release config (this preparation itself is safe
   before approval). The deployed email is excluded from Git. Store a protected
   JSON secrets file `/tmp/root-archive-staging-secrets.json`, mode 0600, containing
   only `ADMIN_EMAILS` equal to the **exact existing policy email**, obtained
   from the policy read. Do not include that file in evidence or Git.

```sh
node --input-type=module <<'JS'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const c=JSON.parse(readFileSync('worker/wrangler.moderation.jsonc','utf8').replace(/^\s*\/\/.*$/gm,''));
delete c.vars.ADMIN_EMAILS;
c.main=resolve('worker/moderation.ts');
c.assets.directory=resolve('admin');
c.d1_databases[0].migrations_dir=resolve('worker/migrations');
c.routes=['admin.archive.rootamman.com','api-staging.rootamman.com'].map(pattern=>({pattern,custom_domain:true,zone_id:'fc80d6a45a703d0fe4d1876f1380870f'}));
mkdirSync('worker/.wrangler',{recursive:true});
writeFileSync('worker/.wrangler/staging-release.json',JSON.stringify(c,null,2)+'\n');
JS
./worker/node_modules/.bin/wrangler deploy --config worker/.wrangler/staging-release.json --dry-run --outdir worker/.wrangler/staging-release-dist
```

5. Deploy the reviewed source and `admin/` assets, staging bindings and secret:

```sh
./worker/node_modules/.bin/wrangler deploy --config worker/.wrangler/staging-release.json --secrets-file /tmp/root-archive-staging-secrets.json --message "Owner-approved isolated staging"
```

This uploads Worker code/assets, binds only the staging D1/R2 and ASSETS,
creates the two **new Custom Domains**, their managed DNS and certificates,
and disables workers.dev/version previews. Equivalent domain API operations are
`PUT /accounts/{account}/workers/domains` for each hostname with
`service="root-archive-moderation-staging"`, the zone ID above,
`enabled=true`, `previews_enabled=false`. Do not separately run both methods.
No zone wildcard route, Cron, R2 domain/CORS/lifecycle or production endpoint is
changed. No real submissions are enabled. Capture Worker version/deployment,
asset upload, domain, DNS and certificate IDs; none exists to list in advance.
Delete the temporary secrets file when the approved deployment is verified.

## Approval group B — hosted synthetic writes and deletion tests

Group B is separate from deploying the empty system. Do not seed anything until
TLS, Access and Worker authorization pass. If the owner cannot authenticate,
leave staging empty; never bypass Access or replace production auth with fixtures.

Use up to **205 synthetic initial records/files**: four lifecycle/recovery cases
and 201 pagination cases, with at most ten additional replacement revisions.
Each initial file is a locally generated PNG fixture, no more than
64 KiB, containing only artificial shapes/text. Use the first known
course ID from `site/courses.json`, type `Summary`, titles
`Synthetic staging <n>`, semester `Synthetic`, no contributor name/email/sub.
No academic content, tokens or student identity is involved.

Reserve submission UUIDs `726f6f74-6172-4368-8000-<12-digit lowercase hex n>`
and initial revision UUIDs `726f6f74-6172-4368-9000-<same n>`, n=1..205.
Check absence before each insert and hold unknown existing objects for review.
Replacements obtain UUIDs from the unmodified admin API. Record exact revision
IDs/keys in the run manifest. The only object prefix permitted is
`private/v1/<manifest submission UUID>/` in the private staging bucket.

Generate the reusable fixture and exact seed manifest locally; this command
launches isolated Chromium without visiting any external service:

```sh
node --input-type=module <<'JS'
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
let png;
try {
  const page=await browser.newPage();
  const data=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=128;c.height=128;
    const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,128,128);
    x.fillStyle='red';x.fillRect(20,40,50,30);
    x.fillStyle='black';x.font='12px sans-serif';x.fillText('SYNTHETIC',10,20);
    return c.toDataURL('image/png').split(',')[1];
  });
  png=Buffer.from(data,'base64');
} finally {await browser.close();}
if(png.length>65536) throw new Error('Fixture too large');
const course=JSON.parse(readFileSync('site/courses.json','utf8'))[0].id;
const records=Array.from({length:205},(_,i)=>{
  const n=i+1,suffix=n.toString(16).padStart(12,'0');
  const id='726f6f74-6172-4368-8000-'+suffix;
  const revision='726f6f74-6172-4368-9000-'+suffix;
  return {id,revision,key:`private/v1/${id}/${revision}.png`,course_id:course,
    title:`Synthetic staging ${n}`,mime:'image/png',size:png.length};
});
mkdirSync('work/staging',{recursive:true});
writeFileSync('work/staging/fixture.png',png);
writeFileSync('work/staging/manifest.json',JSON.stringify({sha256:createHash('sha256').update(png).digest('hex'),records},null,2)+'\n');
JS
```

Seed through the connected Cloudflare APIs, in order for each n:

1. `POST /accounts/{account}/d1/database/f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6/query`
   with `body={batch:[{sql,params},{sql,params}]}` containing the following
   parameterized inserts. Bind
   generated UUIDs/key, course, title, MIME, byte length, UTC timestamps and a
   one-hour upload deadline. Operation string is `staging-seed-<UUID>`.

```sql
INSERT INTO submissions(id,course_id,type,title,semester,status,created_at,updated_at,last_operation)
VALUES(?,?,'Summary',?,'Synthetic','receiving',?,?,?);
INSERT INTO file_revisions(id,submission_id,object_key,kind,filename,mime,size,status,created_at,created_by,upload_deadline)
VALUES(?,?,?,'original','synthetic.png',?,?,'uploading',?,'synthetic-fixture',?);
```

2. `PUT /accounts/{account}/r2/buckets/root-archive-private-staging/objects/{encoded key}`
   with exact generated bytes, content type `application/octet-stream`. Confirm
   returned key/size and retain returned ETag. Never overwrite a preexisting key.
3. At the same D1 query endpoint, use a transactional SQL batch:

```sql
UPDATE file_revisions SET status='ready',etag=? WHERE id=? AND status='uploading';
UPDATE submissions SET status='pending',original_revision_id=?,candidate_revision_id=?
WHERE id=? AND status='receiving';
```

Verify exactly one row changed per update, expected object/hash, and no public
snapshot. Use an explicitly identified seed operation in sanitized evidence;
do not manufacture a `submission_received` audit event or claim `/submit` passed.
If seeding is interrupted, reconcile the same manifest instead of repeating PUTs
blindly; expired intents are handled by the existing cleanup path.

Use the real Access session and existing admin UI/API for subsequent changes.
All writes require `Origin: https://admin.archive.rootamman.com` and
`X-Requested-With: root-admin`; keep cookies/JWTs out of logs and Git.

| Operation / payload | Hosted assertion |
| --- | --- |
| `GET /admin/api/submissions/{id}` | Pending, private revision available only to administrator |
| `POST .../{id}/review`, `{version}` | Review state advances; stale version conflicts |
| `POST .../{id}/metadata`, `{version,course_id,type,title,semester,contributor:null}` | Draft metadata only; published snapshot unchanged |
| `POST .../{id}/revisions`, multipart `version,file` | New immutable private revision; current public file unchanged until approval |
| Portal raster crop/rotate/redact/export/save | Inspect final PNG pixels and stripped metadata; anonymous original unavailable |
| `POST .../{id}/approve`, `{version,revision_id}` | Snapshot published; anonymous GET/HEAD returns only chosen bytes with UUID filename and no-store headers |
| Replay identical approval body | One decision/publication; supported retry succeeds without a second version increment |
| `POST .../{id}/unpublish`, `{version,reason:"Synthetic withdrawal"}` | Immediate new-request GET/HEAD 404; private file retained; same-ID correction/republication works |
| `POST .../{id}/reject` or `/remove`, `{version,reason:"Synthetic removal"}` | Public revocation, metadata/identity scrub and object deletion; tombstone remains |
| `POST /admin/api/cleanup`, `{}` | Bounded retry/progress; repeat safely until all manifest objects are absent |

**Destructive effects:** cleanup can run even with `CLEANUP_ENABLED=false`.
Replacement deletes superseded edited drafts; approval deletes unused/original
revisions; rejection/removal deletes all eligible revisions and scrubs metadata;
failed uploads and manual cleanup also delete eligible bytes. Code/D1 rollback
cannot recover deleted R2 bytes. Publication creates temporary anonymous URLs
for synthetic files. Downloaded copies cannot be recalled.

Publish the 201 pagination fixtures through approval operations, request
`GET https://api-staging.rootamman.com/resources`, follow `next_cursor`, then
withdraw/publish/remove on both sides of a page boundary. Expect a coherent
generation or `409 catalog_changed` and a complete restart; never partial output.
Compare public fields and safe filenames with the manifest, including hostile
synthetic original filenames. End by removing every manifest record through the
admin API and retrying cleanup; retain minimal audit/tombstone rows.

For concurrent writes, send two metadata edits at the same version (one success,
one 409), approval versus withdrawal, and overlapping replacements. Re-read after
ambiguous transport failures before retrying; verify publication/audit/version
and active revision. Close an in-flight synthetic replacement request to exercise
recovery, recording whether the server actually completed; do not label a client
abort as a proven storage outage.

## Hosted security evidence and deliberately unexecuted fault tests

Before group B, enumerate every file under `admin/`, all `/admin/api/*` methods,
private file routes and unknown paths. Test unauthenticated GET/HEAD and API
writes/OPTIONS, forged Access headers, authorized owner login, expired/revoked
session, and an owner-controlled synthetic nonadministrator identity if available.
Anonymous requests must be denied/redirected by Access without serving asset/API
content. Only the exact approved administrator may reach the Worker. Redact OTPs,
cookies and assertions. Never change the allowlist to get a negative test identity in.

Test `/`, each asset path and `/admin/api/*` on `api-staging.rootamman.com`, the
moderation workers.dev name, and any enumerated moderation version-preview
hosts. Public API admin paths must return 404; alternate endpoints must be
disabled. Do not deploy a preview to manufacture a test URL or change legacy
endpoints. Verify Custom Domain preview routing is false and actual TLS SANs,
no caching of resources/downloads, absent Access bypass policies, and R2 public
settings again after deployment.

The application has no hosted D1/R2 failure-injection switch. Group B does
**not** authorize removing bindings, altering credentials, introducing fault
Workers/triggers, or damaging stored files to simulate outages. Controlled
storage deletion failures, D1 transaction aborts, and late PUT races remain local
fault-injection results unless a separate exact hosted fault experiment is
prepared and approved. Natural hosted failures can be observed and reconciled.
Do not claim full hosted failure acceptance from local tests.

Real Access OTP requires actual owner mailbox interaction. External identity and
Turnstile are reported **not exercised** until genuinely completed. No signed
fixture tokens are accepted by the hosted Worker. A later synthetic contributor
flow requires separately approved staging Google/Turnstile/frontend setup;
submissions remain false in this plan.

## Evidence and rollback

Record operation group approval, exact source SHA, UTC times, migration hashes/
ledger, baseline bookmark, Wrangler output IDs, resource/binding inventory,
redacted HTTP status/header assertions, synthetic IDs/keys/hashes, version
conflicts, retries and final D1/R2 checks. Separate sections for real hosted
observations, local emulation/mocks, blocked cases and untested fault scenarios.
Do not store authentication material, full private logs or private-file backups.

Rollback stops tests and new writes, then removes **only** the two newly created
Custom Domain mappings via
`DELETE /accounts/{account}/workers/domains/{recorded new domain ID}`. Verify
their managed DNS no longer routes; remove only any recorded residual test DNS
record. Leave the existing Access protection in place while investigating.
There is no previous staging version on first deployment: disconnect hosts and
retain the isolated Worker/schema for diagnosis. On later runs, deploy a
recorded schema-compatible staging version while retaining revocations. Never
restore the legacy public pipeline or a static catalog as rollback.

New Custom Domain certificates can remain after domain removal. Review their
recorded IDs, then remove only those created by this run using
`DELETE /zones/fc80d6a45a703d0fe4d1876f1380870f/ssl/certificate_packs/{new pack ID}`
if rollback approval covers it. Do not delete preexisting certificate packs.

If identity setup must be reverted, first disconnect staging hosts, then restore
the app's saved writable settings: `allowed_idps=[]`, `session_duration="24h"`,
`http_only_cookie_attribute=false`, `enable_binding_cookie=false`, same hostname,
destinations and existing policy reference. Delete only the newly created OTP
IdP via `DELETE /accounts/{account}/access/identity_providers/{new OTP ID}` after
checking no other app uses it. Do not delete the existing app or policy.

A D1 restore is a separate destructive recovery choice, **not automatic approval**:
while unrouted and with all test writes stopped, use
`wrangler d1 time-travel restore root-archive-moderation-staging --bookmark <recorded pre-migration bookmark> --config worker/wrangler.moderation.jsonc`
only if explicitly approved and the database is still entirely disposable
synthetic staging. Free-plan Time Travel is limited to seven days. It restores
metadata, not deleted R2 files; do not restore publication to missing bytes.
Prefer leaving the compatible schema/tombstones and fixing forward. No database,
bucket, historical preview or legacy object deletion is included in this plan.

Sources: [Custom Domain certificates](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
[Cloudflare identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/),
[email PIN setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Verification of this repository change

Commands executed locally, with external identity/Turnstile mocked:

- `XDG_CONFIG_HOME=/tmp/root-archive-config WRANGLER_SEND_METRICS=false npm --prefix worker run check`:
  generated types/typecheck, both dry-run bundles, 71/71 tests.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:frontend`:
  37/37 browser tests.
- `node --test scripts/*.test.mjs`: 34/34 tests.
- Python unittest discovery: scripts 3/3; analytics 5/5.
- Catalog validation: 127 courses, zero resources. Pinned actionlint and
  synthetic analysis regeneration passed; whitespace check passed.
- The release-config generation above and its Wrangler dry-run passed, with
  only staging DB/private bucket and ASSETS bindings. Versioned migrations
  were also applied to local emulation only. The fixture generator and seed SQL
  were exercised in a fresh local D1/R2 instance: 205 pending records, 205 ready
  revisions, zero public snapshots; the reusable PNG was 1,920 bytes.

There has been no remote migration, Worker deployment, Access/IdP mutation,
custom domain creation, persistent staging test write or hosted lifecycle test.
The new signed-token tests use the configured administrator hostname entirely
inside local workerd. They check asset/API/file GET/HEAD denial, the old hostname
and alternate-host rejection, and failure with missing issuer/AUD/allowlist.
