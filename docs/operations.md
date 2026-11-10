# Owner and contributor guide

## Development loop

Use [the backlog](backlog.md) and GitHub Issues for priorities. Start with an
unblocked task whose acceptance criteria fit one PR. Delegate its issue URL to
Codex, Antigravity, DeepSeek, or another tool with repository access. Require
`AGENTS.md`, a separate branch, exact test results, and a draft PR. Agents do not
share conversation memory; decisions belong in issues/code/docs.

Issues do not automatically launch agents. No paid model API, autonomous runner,
or subscription-sharing mechanism is configured. CI and Dependabot run on
GitHub; implementation delegation and review remain explicit human actions.

Review the diff and CI, test evidence, security implications, and configuration
needs. Request corrections on the same branch. A human chooses when to approve,
merge, and deploy. Avoid simultaneous edits to moderation/storage by separate
agents. Analytics, academic documentation, frontend and dependency work can run
on independent branches if their file scopes remain separate.

## Checks and maintenance

The README lists exact local commands. Ordinary CI requires no production
secrets. The separate protected-base publication reporter requires its own
environment-isolated Checks-only GitHub App credential. Worker checks install from the lockfile, typecheck, dry-run
bundle, and test signed-token submissions, rollback, cleanup and local
workerd/emulated R2. Repository checks validate catalogs, trusted publication
policy/concurrent Git histories, workflows and local measurement, and
generate/analyze synthetic records. These do not verify production integration.

For rollout follow [moderation](moderation.md) and [publication enforcement](publication-enforcement.md).
Require `Submission policy` from a DISTINCT publication App's integration ID,
existing CI, current branches, independent approval and no main bypass. A check
name sourced from GitHub Actions does not identify a trusted workflow. Owner App,
main-only secret environment and ruleset setup plus hosted spoof testing are
outstanding; do not allow submission merges during bootstrap. The reviewed
ruleset currently requires a PR but no checks/approvals; legacy protection reads
were denied by the integration. No live configuration was modified.

Weekly Dependabot PRs cover `/worker` npm and GitHub Actions. Review lockfile,
release notes and passing checks; no auto-merge exists. Use the Actions page
for failed runs and Issues/PR filters for blocked P0/P1 work. Review these weekly:
open failures, dependency alerts, oldest blocked PRs, active P0s and maintenance
issues. Avoid stale-issue bots that close unresolved security/moderation work.
Do not copy private logs or student information into public issue reports.

## Local configuration

Use Node 24 / Python 3.11+, `npm ci --prefix worker`, and the README checks.
Serve `site/` at port 8000 with Python's HTTP server. Real local sign-in requires
test-only OAuth/Turnstile configuration, explicit localhost CORS, and test
storage; the current static frontend still points at the configured live Worker.
Do not use that live endpoint for local experiments. Use a separate untracked
local copy/config before browser testing authenticated flows.

Worker bindings: `GITHUB_TOKEN`, `TURNSTILE_SECRET`, `GOOGLE_CLIENT_ID`,
`GITHUB_OWNER`, `GITHUB_REPO`, `ALLOWED_ORIGIN`, `R2_PUBLIC_BASE_URL`, and
`BUCKET`. Moderation also uses the reviewed root `moderation.config.json`,
`CLEANUP_MODE` and `CLEANUP_ORPHAN_DAYS`; defaults leave
cleanup off with no Cron. Put secrets in ignored `worker/.dev.vars` locally or
approved Cloudflare secret storage for a human-controlled deployment. Never commit them.
The existing public client/site identifiers are not secrets.

Restrict the submission token to this repository with Contents/PR read-write
permissions, no administration/workflow permissions or main bypass. Verify its
identity matches `submission_author`; use a distinct bot identity or another
reviewer when required approvals would otherwise be self-approval. Cloudflare
write credentials must be restricted to intended resources. Public-read R2 does not
permit anonymous writes, and unlisted uploads must never be called private.

## Deployment and rollback (human-controlled)

This task does not deploy. Before any later release: review the moderation
implementation and staging evidence, run CI, record the approved SHA and prior
deployment IDs, verify OAuth origins/client, Turnstile hostnames/secret, CORS, R2 binding
and public-read/write policy, GitHub token permissions, and logging privacy.
Source configuration and existing PRs do not prove those live settings.

Pages should serve `site/` without a framework build. The exact connected build
and deployment configuration must be inspected by the owner. Worker deployment
is available as `npm --prefix worker run deploy`, but is not authorized here.
After explicit release approval, use an isolated staging environment first and
exercise a test-only complete submission/review/publication/rejection lifecycle.
Check live health and data consistency before a production release.

For failure: stop further changes, retain sanitized evidence and known-good
SHA/deployment IDs. Use approved Cloudflare rollback controls after confirming
the previous version's bindings/contracts. Revert repository changes through a
PR; do not rewrite history. Code rollback does not roll back R2 objects,
published catalogs or open moderation PRs. Reconcile those separately; never
bulk-delete resources. Keep approval receipts permanent. Cleanup decisions,
throughput, dry-run rollout, monitoring and per-key removal/reset are documented
in [moderation](moderation.md). Code rollback does not restore deleted files.

## Approval boundaries

Mandatory before launch: owner acceptance of moderation/security and staging,
verification of production settings, full lifecycle testing and human release approval. Legal,
privacy/contact/takedown work needs qualified Jordanian lawyer review. Real
telemetry or academic staging experiments need explicit privacy/ethics and owner
approval. Course requirements/rubrics are still needed for final academic reports.

Optional: GitHub Project views and extra integrations. Neither is needed to run
the tests or switch coding providers. Never authorize external APIs or paid
infrastructure merely to automate delegation.
