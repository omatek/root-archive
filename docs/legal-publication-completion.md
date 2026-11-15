# Final legal-document completion

Baseline: release branch `feat/private-moderation` at
`906f37ec71fd4663f7a2d27acd728cae251d4efe`, incorporating PR #28. Read all six
canonical policies, the coherence report and the internal implementation
checklist. PR #26's private architecture governs this report. No production
comparison, legal research campaign, staging acceptance or security review was
performed. This report supersedes earlier publication-status summaries.

## Publication status

| Document | Result |
| --- | --- |
| Terms of Use | Copy and generated page ready for the intended release. Linked privacy/declaration dependencies still apply to contributor intake. |
| Content and Copyright Policy | Copy and generated page ready. Initial content is original student-authored academic resources; existing exact-revision moderation handles clearance. |
| Takedown and Dispute Procedure | Copy and generated page ready. Existing Unpublish/Remove actions implement restriction and removal; working email and the documented operator procedure support a manual response route; daily monitoring must start before intake. |
| Independence and Non-Affiliation Statement | Ready; no unresolved factual placeholder. |
| Contributor Declaration | Accepted wording and technical integration complete; no bracketed placeholder in the declaration. Accepted text/version remain unchanged (`1.0-reconciled-2026-11-15`). Retain the review banner while the linked Privacy Notice is incomplete. Electronic sufficiency remains a targeted legal question, not a proven defect in the receipt or an established launch prohibition. |
| Privacy Notice | Factual disclosures improved and page regenerated. Remains an incomplete notice because the exact items below cannot be established from current evidence. Retain its banner and noindex. |

The first four documents need no redraft. Copy readiness does not authorize
production deployment or real intake. Declaration receipts still require
migration 0003 before the matching Worker/frontend release; this task applies
no migration. Anonymous one-click downloads, optional credit and the affirmative
submission declaration are preserved.

## Exact remaining disclosures

The Privacy Notice has five bracketed items:

1. DPO professional contact, **only if appointment is required**. Do not invent
   an appointment or publish an unnecessary personal contact.
2. Lawful basis for request delivery/security, sign-in, submission review and
   permission evidence, optional credit, correspondence and administrator
   records. The declaration records copyright permission, not separate privacy
   consent. A basis or exemption cannot be inferred from the technology.
3. Any additional forwarding, mailbox or outgoing-mail provider used for archive
   correspondence. Incoming MX is established as Lark Suite; it does not prove
   that no other provider receives or stores messages.
4. Verified production processing locations or limits, recipient roles and
   applicable international arrangements for the relevant Cloudflare, Google
   and mail flows. Accepted terms and transfer safeguards are not established.
5. Any separate database export, file backup or mail backup lifecycle, or the
   fact that none is used. D1's documented seven-day Free / 30-day Paid history
   window is already disclosed conditionally; selecting a production plan is
   not itself an additional legal-document blocker.

The effective date is tied to first operative production publication; no future
date is invented. A calendar date may be substituted at release. The application
profiling placeholder is resolved narrowly: no advertising profiles or behaviour
ranking in the reviewed code; automated eligibility/security checks are disclosed.
Provider scoring is not represented as absent.

Provider evidence: a read-only Cloudflare DNS API inspection on 15 November 2026
returned `mx1.larksuite.com` (priority 1), `mx2.larksuite.com` (5) and
`mx3.larksuite.com` (10) for rootamman.com. No mailbox messages, forwarding
settings, student data or secrets were read. Existing staging evidence identifies
D1 **and R2** as EEUR ([deployment record](staging-deployment.md)); this is not
proof of production placement, every request location or contractual residency.
The owner established both working contact addresses; no verification was sought.

## Requirements, questions and gaps

| Issue | Established requirement / evidence | Remaining classification and effect |
| --- | --- | --- |
| Jordanian personal-data processing | Prior assessment cites PDPL arts. 4–10 and Rights Regulation 68/2025: a lawful basis, required notice and applicable rights handling are required for covered processing. | **Unresolved interpretation:** which basis/exception and any prescribed consent method apply to each actual purpose, including optional credit. Ask qualified Jordanian counsel that question using the existing flow descriptions. **Factual gap:** complete the resulting basis disclosure and any actually required implementation. No new consent UI is presumed necessary. |
| International processing | Cloudflare/Google/mail flows involve overseas processing; prior assessment cites PDPL arts. 14–15, 24 and the 2025 Security Instructions. | **Unresolved interpretation:** applicable transfer route/conditions, and whether the Instructions require a DPIA for this ordinary-data flow. **Factual gap:** production locations/limits, provider roles, accepted terms and transfer records. Overseas service use alone does not establish that every processing purpose is prohibited. |
| DPO / registry | Prior assessment cites PDPL art. 11(a)(5) and Registry Instructions (initial filing within 30 days of actual processing, updates within 15 days of changes where applicable). | **Unresolved interpretation:** whether direct overseas collection/storage requires a qualifying DPO and which registration duties attach to this individual operation. **Factual gap:** actual commencement of covered processing, including earlier admin/legacy records, and any applicable appointment/filing. If triggered, satisfy it and disclose the professional contact; no exemption or missed deadline is inferred. |
| Electronic contributor authorization | Copyright authority is needed for the exact work; PR #28 records attributable affirmative assent, exact text/version/language, original hash and submission event. Prior assessment cites Copyright Law arts. 9, 13 and the Electronic Transactions Law/amendment. | **Unresolved interpretation:** whether this exact electronic record satisfies the applicable form and evidentiary requirements for the nonexclusive permission. No technical permission-record gap remains. Actual authorship/third-party clearance stays with ordinary moderation. The browser record does not decide legal validity. |
| Digital-media licensing | Prior assessment cites Regulation 13/2026 arts. 2, 4, 6–7, 12–13 and Press and Publications Law art. 49; no applicable licence requirement or exemption was established. | **Unresolved interpretation:** whether a free moderated repository of original student academic notes/practice resources is covered, especially the digital-library provision. Obtain that specific classification before the first public resource; if licensing applies, meet it before distribution. Uncertainty alone is not a verified licensing prohibition. |
| Retention / rights operations | Approved retention schedule and prior rights/complaint/qualifying breach deadlines are retained. Existing moderation, protected cleanup and D1 DELETE support manual operation. | **Factual operational gap:** activate [the short operator procedure](legal-operations.md), including daily coverage, due records, provider settings and selective expiry. The procedure is now written; no claim is made that it is running. No complex retention service is required. |

Legal source links are preserved in the [existing internal checklist](legal/root-archive-implementation-checklist.md).
This task does not independently reverify those laws or convert conditional
triggers into settled conclusions. Optional automation and Arabic companion
text remain optional recommendations from that checklist, not new release gates.
The download notice's contractual effect is not asserted as a source of rights;
the contributor's permission and applicable licences are still necessary.

## Smallest completion steps

Complete the five notice disclosures using existing provider/account records
and the targeted Jordanian answers above; remove the conditional DPO placeholder
if counsel establishes it does not apply. Start the documented operator routine,
including provider retention settings and coverage, before real intake. These
are concrete outstanding facts/actions, not a request for another general review.

Once those items are complete, remove the two review banners and the “review copy is not yet in effect”
sentence, keep the release-linked effective date (or insert the actual date), regenerate with
`node scripts/build-policies.mjs` and run the policy freshness test. If accepted
declaration text changes, change its version and release the generated snapshot
with the Worker and frontend. Schema 0003 and normal production cutover remain
separately scoped release actions. Existing RA-JWT-01 disposition remains open
as recorded; it was not reassessed or expanded here. No merge, deployment,
production infrastructure change or real submission is authorized by this report.

## Focused verification

- `node --test scripts/policies.test.mjs`: **1/1 PASS** (six generated pages,
  declaration snapshot, mapped links, freshness and internal checklist exclusion).
- `node scripts/build-policies.mjs --check`: **PASS**. Regeneration changed only
  the Privacy Notice page; the accepted declaration snapshot is byte-identical.
- `node scripts/catalogs.mjs`: **PASS**, 127 courses, zero static resources.
- `git diff --check`: **PASS**.

No application behaviour, authorization logic, schema or download interaction
is changed. No hosted test or production behaviour is claimed. The existing
portal cleanup button and D1 schema were inspected to substantiate the manual
procedure. Both release PR metadata and the merged PR #28 head were read-only
verified against the baseline above. Existing broad issues are historical scope;
no new review campaign or issue was opened.
