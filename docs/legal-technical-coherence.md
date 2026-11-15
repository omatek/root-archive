# Legal–technical coherence report

**Completion update:** The findings below record PR #28. Current publication status, resolved disclosures and the precise remaining dependencies are in [the final completion report](legal-publication-completion.md). That report supersedes the publication-status and missing-procedure statements below; the implementation and test history remain evidence.

Reviewed baseline: PR #26, `feat/private-moderation`, head
`cacee8f020eadc2a2779d65815732253104224c4` (also the supplied staging acceptance
commit). The remote head was checked before editing. This branch targets that
release candidate, not legacy production. No merge, deployment, Cloudflare
configuration change or hosted test campaign was performed.

## Sources and scope

All **seven attached canonical Phase 2 files** were read and used. Their earlier
unavailability is superseded. The six reconciled policies and updated internal
checklist are in [legal/](legal/). The supplied `root-archive-terms-of-use_2_.md`
was normalized to `root-archive-terms-of-use.md` for consistent cross-links.
The approved retention schedule comes from the assignment and matches the draft
table. The standalone Phase 1 assessment was not attached; its unresolved
questions and supporting citations are preserved from the supplied checklist.
No document is blocked because of its earlier absence, and no new legal research
was undertaken.

## Contradictions and unsupported claims resolved

- Standardized the operator as Omar Khaldoon Jaber Tahrawi, acting individually
  through root, an independent, unincorporated student-led community in Jordan.
  Preserved both confirmed contacts and explicit non-affiliation. Removed the
  unsupported assertion that the separate community site has its own privacy
  notice; that site is simply outside the archive notice's scope.
- Qualified absolute sign-in privacy language: identity is not automatically
  included in public catalog/download responses, but identifying content or
  metadata inside an approved file can become public. Optional pseudonymous
  credit and required third-party attribution remain distinct.
- Clarified that emailed withdrawal/report requests need operator action.
  Applying withdrawal revokes fresh archive downloads immediately; receiving an
  email does not change D1 state automatically. Previously saved copies cannot
  be recalled. The takedown procedure now explicitly preserves permission and
  moderation evidence under their separate retention schedule.
- The Privacy Notice's durations now explicitly identify **approved
  requirements**, rather than implying that automatic expiry already enforces
  them. Added D1's documented plan-dependent backup window without inventing
  immediate backup deletion or a production plan/location.
- Replaced outdated checklist statuses with completed essential staging
  acceptance/cleanup, deferred nonessential campaigns, and open RA-JWT-01.
  Removed a proposed extra publication switch and fixed two-person pilot model
  as implementation requirements. Production cutover and historical public
  artifact handling remain separate release work.
- Closed the technical contributor-permission gap: the old notice and generic
  `submission_received` actor did not preserve accepted wording/version or
  attributable permission after identity scrubbing.

## Authorization and website integration

Migration `0003_contributor_authorizations.sql` adds a separate private receipt.
For each new successful submission it stores verified Google subject/email,
declaration version/language/exact legal text, affirmative checkbox method,
chosen public credit (or null), submission/original revision IDs, SHA-256 of the
original bytes, server timestamp and submission event operation ID. It commits
atomically with the ready revision and receipt audit. Failure rolls back that
acceptance event. No raw Google credential is retained. Updates to receipts are
prohibited; content removal leaves the evidence retrievable through the existing
protected administrator detail API. No historical acceptance is backfilled.

The declaration text is generated from the supplied, minimally reconciled draft,
version `1.0-reconciled-2026-11-15`. A file change clears the checkbox. The page
link exposes the full declaration; the inline notice stays short. This records
copyright permission, **not** a separate purpose-specific privacy consent.
It proves what the authenticated submission represented; it does not establish
actual authorship, third-party rights, or legal validity of electronic assent.

Six static, script-free policy pages preserve the existing fonts, colors and
navigation. Markdown is the source of truth; run
`node scripts/build-policies.mjs` after edits. The checked-in pages and shared
declaration snapshot are checked for freshness by a repository test. `marked` is
a pinned development-only renderer; no new runtime framework was added. The
internal checklist is excluded. Footer links, privacy information before
sign-in, and the exact personal-study notice beside each existing download link
are integrated. Browsing and downloading retain their existing interactions.

Administrator replacement still relies on the moderator to obtain appropriate
permission for changes beyond technical formatting/redaction. The receipt
identifies the original work; revision/audit history identifies administrator
replacements. It does not falsely record a fresh contributor acceptance for an
administrator's revision.

## Implementation, acceptance and deployment

| Layer | Actual status |
| --- | --- |
| PR #26 source | Signed Google/domain checks, Turnstile, Access plus independent Worker JWT verification, private R2 revisions, D1 snapshots, optional public credit, anonymous download revocation and durable file deletion retries are implemented. |
| Recorded staging acceptance | Essential real eligible Google/Turnstile/UI upload, private moderation, publication, exact anonymous download, withdrawal and fresh GET/HEAD 404 passed. Authorized exact-artifact cleanup completed, identity scrubbed, R2 empty and uploads paused. See [final acceptance](student-staging-final-acceptance.md). Not repeated here. |
| This branch | Authorization receipts and policy integration are source/local-test results only. Migration 0003 is not applied remotely. Migrations 0001/0002 were already applied to staging; do not reapply them. |
| Production dependencies | Private production bindings, Worker/Access/Google/Turnstile/origin configuration, frontend cutover and legacy intake retirement remain undeployed. Existing code contains staging account/window guards; a production release must deliberately supply its production configuration. `privateModeration` remains false in the checked-in public configuration. No live state is inferred from source tests. |

## Retention and removal

| Approved schedule | Implementation / remaining gap |
| --- | --- |
| Pending: maximum 30 days without moderation | No age-based expiry of accepted pending/review submissions. The one-hour cleanup deadline concerns interrupted upload intents, not this limit. |
| Rejected/expired files: delete within 7 days | Rejection queues files immediately, with bounded deletion/retries. Accepted pending submissions never expire automatically. A recurring cleanup trigger and backlog operation are absent, so the deadline is not guaranteed. |
| Published: while authorized and published | Only the selected ready revision is served; unused revisions are queued for deletion. Withdrawal requires moderator action. |
| Removed/withdrawn: revoke immediately; private files within 7 days | D1 revocation gates fresh GET/HEAD. Permanent removal queues deletion. Unpublish deliberately retains files indefinitely for review; a terminal remove action is needed to meet the 7-day requirement. No age-based transition exists. |
| Permission: while published plus 24 months after removal | New private receipts survive content scrubbing. No automatic 24-month permission purge is implemented. A safe lifecycle must respect disputed-case/legal holds and the separately retained audit/revision tombstones. Unpublished records still need timely terminal removal. |
| Audit: 24 months after final moderation action | No audit purge. Tombstones support late-PUT reconciliation and cannot simply be cascaded away. Receipt event IDs do not impose a foreign key that would force indefinite audit retention. A selective lifecycle needs separate implementation. |
| Complaints: 12 months after resolution | Email/case operation; no case database or automatic expiry exists in this application. |
| Configurable logs: up to 30 days | Source enables observability; actual provider log/access/trace settings are not established as a 30-day lifecycle by this review. |
| Backups: actual provider lifecycle | Cloudflare documents D1 Time Travel as always on: 7 days on Workers Free, 30 on Paid. Existing staging documentation describes the Free window. Production plan and any exports/mail/provider copies remain facts to establish. R2 DELETE is not proof of provider-wide physical erasure. [Provider documentation](https://developers.cloudflare.com/d1/reference/time-travel/). |

The small permission-evidence change is implemented. Automatic 24-month receipt expiry, a general retention purge,
age-based moderation transitions and cross-service case/log/backup lifecycle are
deferred rather than presented as complete. Existing moderation actions can
support supervised removal, but this report does not claim a monitored manual
deadline process is operating. The Privacy Notice remains blocked until these
requirements have a real enforcement process.

## Publication readiness

| Document | Result after examining the supplied text |
| --- | --- |
| Privacy Notice | **Blocked for substantive reasons.** Effective date, processing bases/profiling disclosure, mail processor, international arrangements/production location, any applicable DPO contact and production backup details remain unresolved. Approved retention/rights operations are not established. Placeholders and a prominent review-draft banner remain. |
| Terms of Use | Reconciled copy and integration ready for the intended private release. Its linked privacy/declaration dependencies must be resolved before live contributor use. The legal effect of the download notice is not established by a browser test. |
| Content and Copyright Policy | Supplied copy reviewed and retained; ready for the intended release with actual private moderation and rights clearance. No malware/originality/automatic-redaction capability is asserted. |
| Takedown and Dispute Procedure | Reconciled copy ready with monitored reporting and actual moderation/retention operations. Email is the working contact route, not an automated case system. |
| Contributor Declaration | **Blocked for live use by substantive legal dependencies.** Technical recording/retrieval is implemented and tested. Legal sufficiency of electronic permission and the incomplete linked Privacy Notice remain unresolved. Banner retained; new version distinguishes the reconciled wording. |
| Independence and Non-Affiliation Statement | Ready; operator, contacts and institutional independence match the established facts. |

Blocked pages are clearly marked review drafts and carry `noindex, nofollow`.
Their presence in the review build does not make them operative notices or
authorize production publication/intake.

## Focused verification

- Final `node --test scripts/policies.test.mjs`: **1/1 PASS**; six generated pages,
  canonical snapshot, public links, internal-checklist exclusion and freshness.
- Final Worker typecheck and moderation dry-run bundle: **PASS**.
  `node --test worker/tests/moderation.test.mjs`: **21/21 PASS** with local
  workerd/D1/R2 and signed/mock external services; includes rejected/stale/duplicate
  acceptance, exact identity/hash/event, rollback, protected retrieval, continued
  revocation and permission preservation after removal.
- Final focused browser run (`private submission|private contributor|policy
  pages|download notice|private security|About introduces`): **6/6 PASS** with
  mocked external services. All policy pages pass mobile layout and axe checks;
  direct download remains one click. [Mobile review image](frontend/screenshots/policy-mobile.png).
- Earlier in this same branch: full Worker check **77/77 PASS** and public/
  student browser suites **32/32 PASS**, before canonical policy integration.
  These were not needlessly repeated; the affected final paths were rechecked above.
- `node scripts/catalogs.mjs`: **127 courses, 0 static resources**;
  `git diff --check` and policy build freshness: **PASS**.

Deployment order is schema 0003 before the updated private Worker, coordinated
with its matching frontend/declaration version. No migration or deployment was
performed. Old frontend versions fail closed when submitting without the current
acceptance. Fix forward if a rollback is needed; preserve permission records,
private storage and revocations. No historical identity or acceptance is invented.

## Material questions outside this implementation

Preserve the supplied Phase 1/checklist questions on Jordanian processing bases,
purpose-specific consent, international processing/Articles 14–15 and related
assessment obligations, DPO/registration duties, and possible Digital Media
Regulation 13/2026 classification. The checklist retains its supporting legal
sources. Electronic work-specific permission and the download notice's legal
effect also remain questions, not engineering conclusions. No new product
restriction or legal research cycle was introduced.

Independent hosted Worker JWT verification remains **UNVERIFIED** and RA-JWT-01
risk disposition remains **OPEN**. Deferred security/session/concurrency and other
nonessential campaigns are not passes. This integration preserves the existing
authentication, Access, Turnstile, storage and audit boundaries.
