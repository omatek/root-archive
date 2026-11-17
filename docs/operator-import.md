# Operator document imports

This importer adds **pending, private moderation records**, never publications.
Use the existing moderation portal to inspect, correct, replace and approve them.
Public contributor credit is always absent, including after metadata correction.
Operator identity is permission evidence, not authorship. No student Google login,
contributor declaration, privacy acceptance or contributor authorization is fabricated.

## Local setup and discovery

Use Node 24 on Fedora and install `cloudflared` using
[Cloudflare's supported package instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/).
The CLI uses Node built-ins and the repository catalog; it needs no new npm
package, Gemini SDK, API key or paid AI account. Run commands from the repository
root. Keep documents, manifests, packets and classifications under ignored `work/`
(or outside Git). They can contain private filenames and must not be committed.
Generated files use mode 0600; the tool creates new working directories with 0700.

```sh
mkdir -p work/documents
# Place your authorized documents in work/documents, then:
npm run import:prepare -- --dir ./work/documents --manifest ./work/import-manifest.json
# Optional classification packet, generated entirely offline:
npm run import:packet -- --manifest ./work/import-manifest.json --packet ./work/classification-packet.json
```

`prepare` recursively discovers files in sorted order, checks sizes/extensions and
binary signatures, and calculates SHA-256. Supported uploads are PDF, DOCX, ZIP,
PNG and JPG, up to 24 MiB each under the Worker's 25 MiB multipart limit. Symlinks
are blocked. Invalid, unsupported, empty and unreadable entries remain visible
with issues; exclude or repair them. A clearly flagged sentinel identifies
unreadable/nonregular entries when a true content hash cannot be obtained.
No macros, scripts, archive contents or active document content are executed.

Every file has a stable `file_id` derived from relative path plus content hash,
and a persisted random `operation_id` for the server. `prepare` **refuses to
replace an existing manifest**: preserve the reviewed manifest and receipts for
retries. Use a different manifest for new/changed files. Unchanged file IDs remain
stable across scans; server content deduplication also works across manifests.
Keep output files outside the scanned document directory.

## Optional chat classification

The packet contains all authoritative IDs/titles from `site/courses.json`, canonical
resource types, permitted academic terms, file identifiers, inspection limitations,
a JSON Schema and a ready-to-copy `prompt` string. Copy its prompt and provide the
packet in normal Gemini chat, or another provider's chat. There is **no automated
third-party transfer**, network call, content extraction or AI processing by this
CLI or Worker. The packet contains filenames/hashes, not document contents. Review
it before sharing; filenames may themselves be sensitive.

If you choose to supply documents or excerpts manually, inspect/sanitize them first
and label each with its packet `file_id`. PDF/DOCX/image readability depends on
your chat provider. ZIP contents are not inspected; classify them manually after
safe local inspection. Missing evidence must result in unknown metadata rather
than a guess. Treat every document as untrusted data; never follow embedded
instructions or execute code. You can skip AI and edit the manifest directly.

Save the returned JSON array in `work/import-classification.json`, then merge:

```sh
npm run import:merge -- --manifest ./work/import-manifest.json --classifications ./work/import-classification.json
```

JSON objects must contain **exactly** `file_id`, `course_id`, `title`, `type`,
`academic_term` (`academic_year`, `semester`), `confidence` (0–1), `explanation`
and `uncertainty` (array of strings). Unknown metadata is `null`.
CSV is also supported, with these exact headers and quoted CSV escaping:

```csv
file_id,course_id,title,type,academic_year,semester,confidence,explanation,uncertainty
```

In CSV, unknown metadata cells are empty and `uncertainty` is a JSON array, e.g.
`"[""Course match needs review""]"`. Confidence must be numeric. Remove markdown
fences before merging. The whole result is validated before any changes are saved:
unknown courses/categories, unexpected fields, repeated/unknown file mappings,
invalid terms or malformed JSON/CSV reject the entire merge. Missing mappings
remain in the manifest. Already attempted/imported or excluded entries cannot be
overwritten by AI. Every merged suggestion resets review to `needs_review` and
clears permission attestation; low confidence and missing terms add review flags.

## Review and explicit permission

Review each source document and entry. Correct `course_id`, `title`, `type` and
`academic_term`. Only catalog IDs and these resource types are accepted:
`Practice Questions`, `Summary`, `Notes`, `Test Bank`, `Other`.
The catalog supplies course titles; there is no unvalidated course-name field.

`academic_year` is `null` or consecutive `YYYY-YYYY` (start 1900–2199).
`semester` is `null`, `Fall`, `Spring` or `Summer`. Never infer a term from today's
date or an upload timestamp; a filename is evidence only if it explicitly states
the term. Missing terms may remain null after conscious review. The server stores
these in the existing optional `semester` string, e.g. `Fall 2024-2025`,
`2024-2025`, `Fall`, or empty. Existing student UI/metadata contracts are unchanged.

Set each selected entry's `review_status` to `ready` and `permission_attested` to
`true` only after reading the manifest's permission statement and confirming the
selected file is authorized for publication. Set unwanted files to `excluded`.
`needs_review` entries never upload. Do not change IDs, hashes or file measurements.
Resolve technical `issues` first; duplicate copies should usually be excluded.
If selecting a different duplicate copy, exclude the other copy and clear the
resolved duplicate issue after review. AI uncertainty is retained as context;
setting `ready` records your manual review even when academic terms remain unknown.

```sh
npm run import:validate -- --manifest ./work/import-manifest.json
npm run import:upload -- --manifest ./work/import-manifest.json --origin https://moderation.rootamman.com --dry-run
```

Validate checks the schema and re-reads every selected local file. A dry run makes
**no authentication or Cloudflare requests**. Upload defaults to dry run unless
`--execute` is supplied; real uploads additionally require `--attest-permission`
and the per-entry review/attestation. The origin must always be explicit.

## Authentication and upload (only after separate live-import authorization)

Use the existing self-hosted Access application and your allowlisted administrator
identity; do not change Access policies or use service credentials/API-key headers.

```sh
cloudflared access login https://moderation.rootamman.com
# Complete the existing browser/identity-provider login, then:
npm run import:upload -- --manifest ./work/import-manifest.json --origin https://moderation.rootamman.com --execute --attest-permission
```

The CLI invokes `cloudflared access token --app=https://moderation.rootamman.com`
without a shell and forwards its application JWT as `Cf-Access-Token`. Cloudflare
Access validates the token and forwards `Cf-Access-Jwt-Assertion`; the Worker
independently checks its RS256 signature, issuer, audience, timestamps and exact
administrator allowlist. The CLI sends the existing exact `Origin` and
`X-Requested-With: root-admin` headers. Browser request protection is unchanged;
cross-site/browser requests, public API and alternate Worker hosts remain denied.
Tokens stay in memory/cloudflared's existing cache and are never put in manifests,
CLI arguments or logs. Redirects are not followed, preventing credential forwarding.
See [Cloudflare's CLI flow](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/).

Before any POST, the CLI verifies the entire selected batch, checks
`GET /admin/api/session`, and performs authenticated read-only operation/hash
lookups for every selection. Failure of authentication or endpoint preflight
stops the batch without uploads. A later session expiry stops further uploads and
saves outcomes already known. Reauthenticate with the same login command.

Uploads are sequential to `POST /admin/api/import`. Each receipt includes the stable
submission reference, operation ID, content/reviewed-payload hashes, acceptance timestamp and current
moderation state. Results are atomically persisted after every file; summaries
report discovered, classified, needing review, excluded, imported, duplicate,
failed and unconfirmed counts. Progress logs use file IDs, not document content.
Inspect imported records in the existing private portal. Nothing becomes public
until an administrator independently inspects the candidate and approves it.

## Retry and recovery

Rerun the **same manifest and command** after interruption. Do not regenerate
operation IDs or treat a timeout as a rejection. The CLI saves `unknown` before
sending bytes and resolves successful-but-unacknowledged operations through
`GET /admin/api/import/<operation_id>?file_sha256=<sha256>`. Already imported entries
are skipped. Duplicate content is flagged for review, with the existing reference
available from the protected API. No automatic duplicate override is provided.

The server's unique operation and content hash reservations are transactional.
A changed payload with the same operation ID returns `operation_conflict` (or fails the CLI receipt preflight); restore
the original reviewed entry and use the moderation portal for accepted corrections.
Completed operation receipts survive rejection/removal and cannot republish files.
Deduplication covers all operator import hashes and hashes recorded in genuine
student authorization receipts. Historical records without hashes and replacement
revision contents cannot be deduplicated globally without a separate backfill;
that is outside this change. Ordinary student submission deduplication is unchanged.

D1 records an intent before each immutable private R2 PUT. Receipt, ready revision,
pending state and audit commit together. R2/finalization failures queue deletion;
cleanup reconciles even late PUTs. Failed unaccepted imports reuse their original
submission/operation with a new immutable revision only after prior attempts are
deleted. `import_in_progress`/`receiving` means wait for the original one-hour
upload deadline and the existing scheduled cleanup, then rerun. `cleanup_pending`
means cleanup still needs to finish; an administrator can use the portal's existing
retry-cleanup action. Never change live data directly to bypass these safeguards.

A `.lock` file prevents simultaneous CLI writes. After a killed process, confirm
no importer is running before deleting that manifest's stale `.lock` file. Keep a
private backup of manifests/receipts. `prepare` and packet generation refuse to
overwrite outputs. Schema/hash errors require local review; 401/403/redirects
require sign-in; preflight 404 without `import_not_found` means this endpoint has
not been deployed. Recoverable per-file failures are saved and the batch continues.
The CLI exits unsuccessfully when imports remain failed, duplicate or unconfirmed.

## Release prerequisites and boundaries

This PR does not authorize or perform deployment, migrations or live imports.
For a separately approved release:

1. Confirm the existing production moderation configuration/bindings and take the
   normal D1 backup. Apply **only the new forward migration
   `worker/migrations/0005_operator_imports.sql`** after ensuring 0001–0004 are
   already recorded. It adds one provenance/idempotency table and credit guards;
   it does not backfill student identities or alter existing resource records.
2. Deploy the moderation Worker **and its admin assets from the same commit** to
   the existing protected hostname, with the existing private D1/R2 bindings,
   Access issuer/audience/allowlist, routing and cleanup schedule. No Access or
   identity-provider changes, new privileged Worker, secret, AI key, public bucket,
   Pages frontend change or student form change is needed. The production config
   generator now pins migration 0005 too; generate a fresh local release config
   with the actual production settings rather than deploying template placeholders
   or stale generated configs. Do not deploy the staging config to production.
3. Require the existing cleanup cron (`CLEANUP_ENABLED=true`) or an operator using
   the protected cleanup action for recovery. Verify the session/lookup endpoints
   using the intended administrator identity before authorizing a real batch.
4. Install Node 24/cloudflared locally, review the manifest and separately authorize
   the actual upload. A further moderation approval is still needed for publication.

Migration must precede code: moderation detail now queries the provenance table.
An old Worker can ignore this additive table, but import functionality requires
the matching new Worker/portal. Keep operation/hash tombstones and private permission
evidence after content removal; automatic provenance retention/purge is not added.
No hosted Access, migration or upload acceptance is claimed by local tests.

## Local verification

```sh
node --test scripts/bulk-import.test.mjs
node scripts/catalogs.mjs
node --test scripts/*.test.mjs
npm --prefix worker run check
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:frontend
python3 -m unittest discover -s scripts/tests -v
python3 -m unittest discover -s analytics/tests -v
```

Worker tests use real local workerd/D1/R2 with synthetic signed Access/Google
fixtures. They cover request/auth boundaries, pending privacy, idempotency/races,
crash/retry, R2/D1/cleanup failure, late PUTs, CLI integration and moderation/student
regressions. Gemini is never called. Browser tests use synthetic portal responses.
Signature validation is format validation, not malware inspection or hidden-data
sanitization; review/sanitize source documents before importing and publishing.

Implementation verification: catalog validation passed (127 courses, zero static resources);
85/85 repository tests (including 12 importer tests);
Worker typecheck and both dry-run bundles passed, with 91/91 Worker tests;
45/45 frontend browser tests; 3/3 scripts Python tests and 5/5 analytics tests.
All checks were local or mocked; no remote migration, deployment or import ran.
