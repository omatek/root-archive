# Final real-contributor staging acceptance

**Essential end-to-end workflow PASS. Authorized cleanup COMPLETE. Uploads PAUSED.**

One approved synthetic PDF traveled through the actual student frontend with
real eligible Google authentication, the protected account allowlist and live
Turnstile Siteverify. Private pending storage, administrator discovery/approval,
anonymous catalog/download (200, exact approved SHA256), withdrawal, and fresh
same-URL GET/HEAD denial (404) passed. The owner observed ineligible-account and
paused-submission denials; independent storage reads confirmed no writes from them.
The automatic upload cutoff was deployed and locally verified; upload enablement
was also explicitly paused immediately after successful receipt.

## Authorized cleanup and final state

- Submission `3de6408a-e12a-4573-a772-fd8e0228ea22`: removed/version 4;
  contributor email/sub/credit cleared and revision pointers null.
- Revision `3879def6-19ce-4b29-a202-d44b897fde40`: deleted; exact authorized
  key absent (independent GET 404), staging R2 listing empty.
- Submission/resource tombstones retained; all 16 preexisting audits retained
  and one `resource_removed` event appended with explicit control-plane actor.
  Historical fixtures unchanged; no unresolved file operations or FK violations.
- `SUBMISSIONS_ENABLED=false`, both window timestamps empty; cleanup Cron off.
  R2 managed public access disabled and no custom domains.
- Fresh anonymous catalog empty; download GET/HEAD 404 after cleanup.
- Production legacy deployment `88fef60a-22b0-434a-bbc2-89ac0d569629` and Pages
  deployment `60b32faf-7934-4e5b-8a34-c07c1cb0983d` unchanged. No production
  mutations, onboarding, infrastructure additions or PR merge occurred.

The owner explicitly authorized autonomous exact-scope removal. Cleanup used
guarded D1 updates and exact-key R2 DELETE through authorized Cloudflare APIs,
followed by separate read-only verification. It did **not** use or bypass an
administrator browser session and is **not** a passing portal-removal test.
No application source or security control was changed during final cleanup.

[Cleanup mutation and independent proof](student-staging-cleanup-proof.json),
[pending privacy/hash](student-staging-pending-proof.json),
[publication/download](student-staging-publication-proof.json),
[withdrawal/404](student-staging-withdrawal-proof.json),
[completed manifest](student-staging-live-manifest.json).

## Deferred and unverified

All remaining nonessential campaigns are **DEFERRED, NOT PASSED**: manual hosted
missing/invalid Turnstile denials (local rejection coverage passes), forced
administrator session-expiry/recovery, portal permanent removal for this PDF,
fixture 4 deterministic concurrency, focused pagination and other synthetic
race/interruption/recovery campaigns. The artificial 200 ms interruption case
was removed as a gate and was not run. No additional campaign was initiated.

**Independent hosted Worker JWT verification remains UNVERIFIED. RA-JWT-01 is
OPEN; risk has NOT been accepted or resolved.** In particular, positive admin
actions do not prove hosted rejection of invalid signatures, wrong issuer or
audience, or expired signed Access tokens. Real-contributor onboarding still
requires the separately documented owner decision on this uncertainty; this
functional acceptance does not supply that decision.

## Genuine remaining launch blockers

For the first two trusted contributors: the unresolved hosted-JWT risk decision
above, plus explicit authorization/configuration for the bounded real-material
pilot and its two named accounts. The current authorization and configuration
cover a completed synthetic run with uploads closed; no pilot is active.

For production/public launch: production private D1/R2 and Worker/Access/frontend
integration and an approved cutover that pauses legacy upload entrypoints have
not been performed. Current production still runs the legacy path. These are
separate from this passing isolated staging workflow. Deferred campaigns are
not represented as additional passing evidence or silently elevated into new
pilot gates. This task is finished; no further operations are initiated.
