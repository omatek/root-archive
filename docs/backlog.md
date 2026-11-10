# Prioritized engineering backlog

Baseline: 2026-11-09. Existing PRs #1–#3 are resource submissions; no engineering issues were found before this task. Completed foundations are described in the README, not duplicated as unfinished implementation tasks. GitHub Issues are the active tracking surface; no Projects capability was available.

The first five recommended tasks are recovery (P0), trusted publication (P0), safe cleanup (P0), UI repairs (P1), and offline analytics (P1). Publication/cleanup depend on recovery; UI and analytics can proceed on separate files while recovery is blocked. Full lifecycle verification follows the P0 implementations. Approval and acceptance criteria are stated below.

## [P0] Recover simplified submission moderation artifacts

**Priority:** P0

**Objective:** Establish whether the reported simplified implementation can be recovered before authorizing reconstruction.

**Scope:** Obtain a full SHA, Git bundle, patch or accessible branch for 535b2ce/fix/submission-moderation. Compare against current main and preserve any recovered work on its own branch. Both historical short SHAs currently return no commit from GitHub.

**Dependencies:** None; blocking input is the missing historical artifact. Do not recreate the superseded private-download architecture.

**Components:** Git refs, worker/worker.ts, submissions/, site/resources.json, any recovered workflows/tests.

**Acceptance criteria:** Record recovery evidence and exact full SHA; run recovered checks; identify overlap with main; produce an isolated reviewable PR or a concrete reconstruction issue supported by evidence. Do not mark production verified.

**Automated tests:** Run artifact integrity checks and recovered unit/workerd tests; compare public-read R2, direct catalog proposal, rollback and cleanup behavior against the accepted requirements.

**Deliverables:** Recovery report and preserved feature branch/draft PR; explicit remaining gaps.

**Agent independence / concurrency:** Agent can inspect/reconcile independently. Reconstruction requires a separately assigned task. Do not concurrently edit moderation/storage.

**Human approval / external configuration:** Owner may need to supply or restore the unavailable artifact. No deployment or storage-policy changes.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P0] Implement trusted catalog publication validation and concurrent PR handling

**Priority:** P0

**Objective:** Ensure only approved submission catalog additions can be merged without changing existing resources or executable repository files.

**Scope:** After recovery, reuse actual moderation design. Validate allowed paths, submission fields, append-only catalog changes, object references and concurrent submissions. General schema CI is not a publication authorization gate.

**Dependencies:** Recover/reconcile simplified moderation first. Coordinate with cleanup on approved-object identity contract.

**Components:** Submission PR lifecycle, site/resources.json, trusted validation scripts, .github/workflows/.

**Acceptance criteria:** Trusted base code rejects unauthorized file changes, existing-entry mutation/removal, duplicates and unsafe metadata. Two valid concurrent PRs can be reconciled without lost updates. Works with required reviews and protected main.

**Automated tests:** Adversarial PR-diff tests, validator-tampering attempt, stale-base/concurrent addition tests, malformed metadata, allowed happy path and zero privileged execution of PR scripts.

**Deliverables:** Focused code, test fixtures, workflow trust explanation and required-check guidance.

**Agent independence / concurrency:** Agent-ready after recovery. One moderation editor at a time; may coordinate tests on separate files.

**Human approval / external configuration:** Owner applies branch protection only after review. No production credential use or merging by agent.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P0] Add safe rejected and orphaned upload cleanup with recovery monitoring

**Priority:** P0

**Objective:** Bound public orphan retention while protecting every approved resource.

**Scope:** Reuse recovered cleanup if available. Cover rejected/expired/orphaned uploads, failed GitHub rollback, grace periods, pagination, retries, overlapping runs, partial failures and conservative behavior when catalog/GitHub evidence is unavailable.

**Dependencies:** Recover moderation and define authoritative approved-object identity with publication validation.

**Components:** Worker scheduled handler, R2 metadata, GitHub/catalog reads, Wrangler proposed trigger, cleanup tests and operating guide.

**Acceptance criteria:** Approved objects are never deleted, including during API failure/stale observations/concurrent publication. Dry-run decision evidence is inspectable. Failed deletes are retryable and visible without exposing student data. Document retention, safe rollout and recovery.

**Automated tests:** Local workerd/R2 tests for approved protection, rejection, expiry, orphan grace, pagination, race conditions and upstream/delete failures. Never use production R2.

**Deliverables:** Implementation or recovered fixes, local integration suite, monitoring and incident-recovery procedure.

**Agent independence / concurrency:** Agent-ready after contract reconciliation; serialize moderation/storage edits.

**Human approval / external configuration:** Owner approves retention policy, Cron activation, monitoring and any staging/production deletion experiment. No live deletions in implementation task.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P0] Verify full student and moderator lifecycle before production rollout

**Priority:** P0

**Objective:** Establish end-to-end security and reliability evidence before a human-controlled launch.

**Scope:** Test signed Google JWT verification/expiry/issuer/audience, exact domain rejection, CORS, Turnstile, file/body limits, GitHub failure rollback, submission review/publication/rejection and cleanup. Inspect token scopes and logging privacy. Prepare custom-domain/OAuth/Turnstile/R2 configuration and rollback plan.

**Dependencies:** Recovered moderation, trusted publication validation and cleanup. Local tests can begin earlier on isolated files.

**Components:** Worker and frontend integration fixtures, Cloudflare/GitHub configuration checklist, docs/operations.md.

**Acceptance criteria:** Local complete lifecycle and failure suite passes; untrusted PRs receive no production secrets; operational gaps are recorded; staging plan and human release checklist identify exact settings and approved SHA. Live claims require separate evidence.

**Automated tests:** Mocked local signed-token/JWKS, Turnstile, R2 and GitHub tests; size boundary and storage-failure cases; eventual isolated staging smoke tests only after approval.

**Deliverables:** Reproducible integration suite, security findings, proposed production settings and release/rollback checklist.

**Agent independence / concurrency:** Agent can build local fixtures independently; serialize changes to security-critical runtime code.

**Human approval / external configuration:** Owner must verify credentials, Cloudflare Pages/Worker/R2 settings, OAuth origins, Turnstile hostnames, CORS, custom DNS, branch protection and explicitly approve rollout. No live changes under this issue without that approval.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P1] Repair submission UX and check mobile accessibility

**Priority:** P1

**Objective:** Fix the identified small UI defects while preserving root/archive appearance and backend authorization.

**Scope:** Restore Notes in frontend and Worker contracts together, remove overlapping domain label, remove GIS account-selection hd hint only, improve rejection messages, add understated footer/navigation and check responsive/a11y behavior.

**Dependencies:** Coordinate Notes with catalog validator and any recovered moderation type allowlists. Other small UI edits can proceed independently.

**Components:** site/index.html, worker/worker.ts type allowlist only, scripts/catalogs.mjs and related tests.

**Acceptance criteria:** Notes can pass every intended validator; GIS selects accounts without hd hint; Worker exact email/hd authorization remains enforced; labels do not overlap; keyboard/mobile flows work; no redesign.

**Automated tests:** Boundary tests proving out-of-domain accounts stay rejected, Notes contract tests and targeted browser/keyboard/mobile checks with local mocks.

**Deliverables:** Focused UI/contract patch, tests and before/after screenshots.

**Agent independence / concurrency:** Agent-ready now for UI-only changes; coordinate security/type edits with moderation owner.

**Human approval / external configuration:** No deployment or production OAuth changes. Human reviews visual result.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P1] Prepare reviewed privacy, legal, contact and takedown flows

**Priority:** P1

**Objective:** Provide accurate reporting/contact behavior and documents reflecting actual data practices.

**Scope:** Draft Privacy Policy, Terms, Content/Copyright Policy, independence notice and takedown process; implement a contact/report mechanism after a real destination is selected. Never publish finalized legal/compliance claims without qualified review.

**Dependencies:** Owner chooses contact destination and retention/access model; reconcile actual moderation and logging behavior before final legal review.

**Components:** Future site legal pages/footer, reporting/contact flow, privacy and operations docs.

**Acceptance criteria:** Functional contact/takedown path reaches an owner-selected destination without unnecessary personal data. Drafts clearly distinguish public uploads and unverified behavior; no institutional affiliation or legal immunity claims. Qualified Jordanian lawyer reviews before publication.

**Automated tests:** Local contact validation/error handling, link/navigation/accessibility checks and no-secret/private-data checks.

**Deliverables:** Reviewable document drafts, working local reporting flow and launch checklist.

**Agent independence / concurrency:** Agent can draft factual materials independently; destination integration and legal approval are blockers to launch.

**Human approval / external configuration:** Owner selects destination and access; qualified Jordanian lawyer review required. Paid services or publication require separate approval.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P1] Extend Cloud Computing measurements and coursework evaluation

**Priority:** P1

**Objective:** Turn the architecture foundation into measured, reproducible coursework evidence.

**Scope:** Add isolated local Worker/R2/GitHub fault and bounded concurrency experiments, aggregate raw latency results, evaluate reliability/storage/serverless limits, estimate costs with stated assumptions and write evidence-based coursework sections.

**Dependencies:** Use docs/academic/cloud-computing and scripts/measure_local.py. Publication/cleanup experiments depend on their implementation; get assignment rubric before final report.

**Components:** docs/academic/cloud-computing/, scripts/, local integration fixtures.

**Acceptance criteria:** Commands and runtime versions reproduce local outputs; statuses and storage invariants are verified; measurements are labeled by environment; no invented production performance/bills; report identifies limitations and rubric gaps.

**Automated tests:** Local success/fault/timeout/size-boundary tests and deterministic aggregation fixtures. Bounded local load only.

**Deliverables:** Experiment scripts, sanitized raw results, plots, reliability/cost analysis and final-report draft.

**Agent independence / concurrency:** Agent-ready for local tools/docs now; parallel with analytics/frontend on separate files.

**Human approval / external configuration:** Owner approval for staging/production traffic or new resources. Course requirements and any academic ethics/IP rules need human confirmation.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P1] Add held-out synthetic detection experiments and telemetry design

**Priority:** P1

**Objective:** Extend reproducible descriptive analytics without label leakage or activating real student-data collection.

**Scope:** Use observable fields for simple rules; reserve distinct generator seeds/distributions and document circular-design limitations. Report confusion matrices/precision/recall/F1. Plan controlled local mocks for missing/invalid auth, wrong domains, Turnstile, multipart, oversized files, suspicious metadata, duplicate IDs, bursts and dependency failures.

**Dependencies:** analytics/ foundation; actual runtime mock experiments depend on integration fixtures. Obtain assignment rubric before final coursework report.

**Components:** analytics/ schema/generator/analysis/tests/report templates; future private telemetry design docs only.

**Acceptance criteria:** No label/provenance/classification input leakage; independently configurable evaluation mix; failure cases and limitations documented; results reproducible. Distinguish generated scenarios from executed local experiments and observed production events.

**Automated tests:** Metrics against hand-computed confusion matrices, leakage checks, train/evaluation separation and reproducibility tests.

**Deliverables:** Rule analysis, evaluation outputs/plots, findings template, local mock experiment plan and privacy-first telemetry proposal.

**Agent independence / concurrency:** Agent-ready now, independently of production and moderation. Can run concurrently with cloud docs on separate files.

**Human approval / external configuration:** No approval needed for offline synthetic work. Real collection/private storage/retention requires owner, privacy and applicable ethics review; never use public resource R2.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P2] Build static course practice quizzes with reviewed original banks

**Priority:** P2

**Objective:** Offer simple original Midterm/Final practice without account storage or live AI calls.

**Scope:** Static JSON banks; MCQs with explanations, retries and client grading; two or three variants per logical question and exactly one per attempt; separate engine and data. No database/profiles/leaderboards.

**Dependencies:** Human-authored/reviewed original question banks and selected initial courses. Not part of this foundations implementation.

**Components:** Future site quiz UI, static banks, schema validation and CI.

**Acceptance criteria:** Supported courses expose Midterm and Final; one variant per logical question; grading/explanations/retry work; schema rejects duplicate IDs/bad answers; every published question has human review and independent authorship evidence.

**Automated tests:** Bank-schema failures, variant-selection invariants, grading/retry tests and keyboard/mobile browser checks.

**Deliverables:** Small reusable quiz engine, JSON schema, original pilot banks and review checklist.

**Agent independence / concurrency:** Agent can build engine/validator independently when assigned; content authors/reviewers can work separately.

**Human approval / external configuration:** Human content/copyright review required before publication. No deployment or paid model calls.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.

## [P1] Maintain CI, dependencies and operational readiness

**Priority:** P1

**Objective:** Keep the new workflow usable and track unresolved failures without silently closing critical work.

**Scope:** After review/merge, observe actual check names, enable required reviews/checks manually, triage Dependabot and dependency alerts, and periodically review open P0/P1s, failing checks, stale blocked PRs and operational risks. Add useful checks only as features arrive.

**Dependencies:** Foundations PR merged by a human. Publication required checks depend on trusted moderation validation.

**Components:** .github/, worker/package-lock.json, docs/operations.md and GitHub issue/PR views.

**Acceptance criteria:** Read-only/no-secret PR CI remains intact; npm and Actions weekly updates produce reviewable PRs; failures and P0s have owners/next actions; no auto-merge, paid runner orchestration or stale-bot closure of unresolved security issues.

**Automated tests:** Run affected checks on dependency changes; inspect permissions/pins and regression behavior; verify actual GitHub runs rather than assuming configured CI passed.

**Deliverables:** Focused maintenance PRs, owner-selected branch rules and current issue state. No additional service is required.

**Agent independence / concurrency:** Agent can inspect/update dependencies independently on separate branches; shared workflow edits need coordination.

**Human approval / external configuration:** Owner applies branch rules and merges reviewed changes. Do not alter protections or credentials automatically.

Read `AGENTS.md`; use a separate feature branch and draft PR. Report exact tests and full commit SHA. Do not merge or deploy.
