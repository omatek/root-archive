# Real contributor staging acceptance — minimum scope

**Essential functional cycle PASS. Uploads PAUSED. Cleanup confirmation pending.**
This is isolated staging evidence for one synthetic PDF, not production cutover,
permission to onboard contributors, or exhaustive certification. PR #26 remains
unmerged by this task; production/legacy infrastructure was not mutated.

| Check | Evidence/result |
| --- | --- |
| Eligible Google account and exact protected allowlist | Owner saw verified status; normal upload rechecked Google authorization |
| Real Turnstile | Normal UI upload passed live Siteverify before D1/R2 writes |
| Ineligible account | Owner observed eligibility denial; no new records/objects |
| Server pause | Owner observed paused rejection; zero storage changes; final boolean false and timestamps empty |
| Actual frontend PDF | One accepted random UUID, 687-byte approved PDF; no seeding or denial helper |
| Private pending | Pending/v1, one ready private revision; no public snapshot; anonymous GET/HEAD 404 |
| Portal discovery/approval | Owner approved exact candidate; D1 published/v2 and approval audit |
| Public catalog/download | Anonymous catalog/GET/HEAD 200; exact approved SHA256, UUID filename and no-store |
| Withdrawal | Owner unpublish, unpublished/v3, audit; empty catalog and fresh same-URL GET/HEAD 404 |
| Private retention | Original file remains private/ready with unchanged SHA256 |
| Cleanup | HELD: explicit confirmation of exact identifiers required before permanent removal |

Submission: `3de6408a-e12a-4573-a772-fd8e0228ea22`.
Revision: `3879def6-19ce-4b29-a202-d44b897fde40`.
Bucket: `root-archive-private-staging`.
Key: `private/v1/3de6408a-e12a-4573-a772-fd8e0228ea22/3879def6-19ce-4b29-a202-d44b897fde40.pdf`.
SHA256: `f225b67a86db912394042bca309b0691727e22ef3bd741b044ec0543906151d1`.
Current backend: `0f8024b1-b62d-4aff-a8bc-8f7b521498f5`; frontend:
`30f908f3-9faa-4799-b566-c46b3cc8da41`. The two bounded intervals allocated at
most the approved 60 minutes; the final one was explicitly closed early on the
successful receipt. The Worker also enforces an independent automatic cutoff.

[Pending/hash/privacy](student-staging-pending-proof.json),
[approval/anonymous download](student-staging-publication-proof.json),
[withdrawal/final pause/production state](student-staging-withdrawal-proof.json),
[live manifest](student-staging-live-manifest.json).

## Unresolved checks and decisions

- Manual hosted missing/invalid Turnstile checks are **DEFERRED, NOT PASSED**, at
  the owner's request. Relevant local rejection tests and absent/blank validator
  checks pass. No Google/Turnstile/allowlist/administrator control was disabled.
- **RA-JWT-01 remains OPEN:** independent hosted Worker invalid-signature,
  issuer/audience and expired signed Access JWT rejection checks remain
  **UNVERIFIED, NOT PASSED**. Positive portal actions do not close this decision.
  Real expired/revoked administrator-session denial/recovery was not exercised
  in this streamlined cycle. No extra logout or security campaign was added.
- Fixture 4 deterministic concurrency and focused pagination remain deferred
  to merge/launch acceptance. The artificial 200 ms interruption test is not a gate.

## Minimum remaining for the first two trusted contributors

1. Confirm and finish this exact synthetic cleanup, preserving audit/tombstones.
2. Make a separate documented owner decision on the unverified hosted JWT/session
   cases: complete them or explicitly accept their deferral for a bounded pilot.
   This document does not accept the risk on the owner's behalf.
3. Separately approve the pilot: two named protected allowlist accounts, approved
   material/permission/privacy wording, a small upload/byte budget, one available
   moderator, a withdrawal/contact path, and a monitored manual cleanup cadence.
   A supervised window of at most 60 minutes remains compatible with the existing
   cutoff implementation. No extra feature or new test campaign is implied.

A pilot on the isolated staging endpoints requires explicit approval for real
contributors/materials; the present authorization covered only this synthetic run.

## Full public launch is separate

Approve/provision separate production private D1/R2, production Worker/Access and
public frontend integration; perform an explicit routing/cutover window; pause
all legacy upload entrypoints and disposition historical public assets/previews.
Verify production request throttling, recurring cleanup/monitoring and revocation
headers, and decide the deferred merge/launch acceptance scope. Preserve the
download gate/tombstones during rollback. None of these infrastructure changes,
PR merging, or unrestricted contributor admission is authorized/performed here.
