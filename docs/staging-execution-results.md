# Staging execution results — 14 November 2026

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
