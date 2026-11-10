# Publication gate identity and staging acceptance

## Finding and observed configuration

A name-based required check does not identify its workflow. A fork's Actions job
can also be called `Submission policy`. Both jobs use the GitHub Actions App
(identity 15368, observed on this repository's existing CI), so selecting that
App as the expected source is insufficient. GitHub also distinguishes commit
statuses and check runs: when both exist under a required name, both must pass;
that does not make an absent trusted reporter distinguishable by name alone.
See [GitHub's status-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
and [available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging).

Read-only observation on 2026-11-10: this is a public, personally owned repository.
Active ruleset `26518493` (Protect main) contains deletion/non-fast-forward
restrictions and a PR requirement with zero required approvals; it has no
required-check/workflow rule. No bypass actor was listed. The legacy protection
endpoint returned 403 (`Resource not accessible by integration`), so its complete
configuration could not be audited through that endpoint. No settings changed.
Neither current source nor passing CI establishes an enforced publication gate.

## Native options and chosen implementation

Preferred when available: an organization/enterprise **Require workflows to pass
before merging** ruleset, selecting the trusted source repository, workflow path
and protected ref. This binds workflow identity rather than a job name. GitHub
currently documents this as an Enterprise Cloud / Enterprise Server (3.12+)
organization/enterprise feature; ordinary repository rulesets being available on
public repositories does not grant that feature. The current personal repository
has no organization ruleset source. No account plan was inspected and no move or
upgrade is authorized. See the [required-workflow rule](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging)
and [GitHub's feature definition](https://github.com/github/docs/blob/main/data/features/repo-rules-required-workflows.yml).

For this repository, the implemented alternative uses GitHub's native
**App-bound required check**:

1. An owner creates a dedicated publication GitHub App, installed only on the
   intended repository, with Checks read/write and inherent Metadata read. It
   needs no Contents/PR/Actions/admin write or branch-protection bypass, webhook
   service, database, external hosting or paid orchestration.
2. First configure environment `publication-validator` to allow deployments
   **only from `main`** (explicit selected-branch policy; no PR refs or wildcard).
   These environment controls are available on public repositories across current
   GitHub plans ([environment reference](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).
   Keep main protected. Store `PUBLICATION_APP_PRIVATE_KEY` only as that
   environment's secret, and `PUBLICATION_APP_ID` as its variable. Do not place
   the key in repository-wide secrets or expose it to ordinary PR CI. Independent
   environment approval may be added, but is not a substitute for source binding.
3. The protected-base target workflow mints a short-lived, repository-scoped
   Checks-write token through a pinned official GitHub Action. Ordinary
   `GITHUB_TOKEN` remains read-only and handles PR/permission reads. Only the
   separate App token writes `Submission policy` check runs on the exact PR head.
   The script verifies the returned check's App ID and rejects the Actions App
   or missing credentials; there is no token/source fallback. The token action
   revokes its token at job completion.
4. After observing a canary check, require `Submission policy` with the dedicated
   **App's numeric integration ID**, plus existing CI, up-to-date branches,
   independent approval, stale-approval dismissal and no main bypasses. Verify
   the ruleset's `required_status_checks[].integration_id`, not just its UI name.
   Selecting GitHub Actions or Any source leaves the finding unresolved.

An unauthorized Actions job can copy the name, but cannot emit a check under the
separate App identity without its credential. The main-only environment and
base-only execution prevent fork code from obtaining that credential. Trusted
repository administrators/writers and credential compromise remain outside that
boundary. The custom App and environment/ruleset setup are owner actions, not
performed by this task. Until configured and acceptance-tested, publication is
**not launch-ready**. Do not grant bypasses to get around a missing check.

The workflow still uses `pull_request_target` only to execute base code, never
head scripts. GitHub documents an upcoming default event-policy block for public
repositories on December 2, 2026; the owner must verify/allow this exact trusted
workflow in the account's Actions policy. Execution policy alone is not a
replacement for App/source binding. See [workflow execution protections](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution).

## Current authorization and reruns

The event supplies only PR number and requested SHA. The validator fetches live
labels, author, head/ref/repository, base/ref/repository/SHA and state, and looks
up the current author's repository permission for maintenance. After diff/asset
validation it fetches the live PR again, rejects changed authorization inputs,
rechecks writer permission and revalidates policy immediately before completing
the App check. A past labeled event or past permission result is never reused.

Checks are commit-scoped, not transactional merge-time authorization. On label or
permission removal, require fresh validation and verify the latest dedicated-App
result before merging. If reporting is unavailable, hold the PR; a new commit
ensures no prior green result can be reused. No automatic merge is enabled.
There remains a final authorization-read/report/merge interval; independent
maintainer review must consider current authorization. These instructions do not
claim instantaneous revocation of every previously emitted check.

## Reproducible hosted spoof test — not executed here

Use an **owner-approved disposable staging repository and fork**, never a live
student PR. Record tested SHA, ruleset JSON, App ID, environment restrictions,
check-run IDs/App IDs and mergeability for every case. The repository must have
no other failing requirements so a blocked result is attributable to this gate.

1. Configure the chosen enforcement option above in staging. Open a valid canary,
   observe the real dedicated App success and required reviews. Verify normal
   green publication can merge. Do not merge production code as a test.
2. Keep the required App binding active but make the trusted reporter unavailable
   in staging (for example, require environment approval and leave it pending).
   Start with a **fresh head SHA** that has never had an authorized App result.
3. In the staging fork, copy `scripts/fixtures/spoof-publication-check.yml` to
   `.github/workflows/spoof-publication-check.yml`, add an unauthorized catalog
   change that still passes general JSON/schema CI (or a student catalog/receipt
   proposal plus an extra Worker edit), push, and open a PR. Approve the untrusted workflow run
   if staging requires it. The fixture is deliberately a successful job named
   `Submission policy`; it is inert data at its checked-in path in this project.
4. Inspect the actual head and runs with the read-only commands below (set the
   three variables to staging values). Check both the PR head and GitHub's test
   merge SHA if present; GitHub may evaluate the latter for PR workflows.

```sh
STAGING_REPO=owner/disposable-repository
STAGING_PR=17
PUBLICATION_APP_ID=123456
head_sha=$(gh pr view "$STAGING_PR" --repo "$STAGING_REPO" --json headRefOid --jq .headRefOid)
gh api "repos/$STAGING_REPO/commits/$head_sha/check-runs" --jq '.check_runs[] | {id,name,conclusion,app_id:.app.id}'
gh api "repos/$STAGING_REPO/pulls/$STAGING_PR" --jq '{head:.head.sha,test_merge:.merge_commit_sha,mergeable_state}'
test "$(gh pr view "$STAGING_PR" --repo "$STAGING_REPO" --json mergeStateStatus --jq .mergeStateStatus)" = BLOCKED
```

Inspect the active ruleset with `gh api repos/OWNER/REPO/rulesets/ID`; its
`required_status_checks` parameters must contain the dedicated App
`integration_id`, not 15368 or an omitted source.

Expected assertions: the lookalike check is green under App **15368**; there is
no successful `Submission policy` check from `PUBLICATION_APP_ID` for the
applicable SHA; ruleset JSON still requires that exact App ID; the PR is BLOCKED
and GitHub refuses a staging merge as a non-bypass actor. A same-named green job
must not make the merge available. If it does, stop: enforcement is misconfigured.

5. Enable the trusted reporter. It must reject the unauthorized diff under its
   own App identity while the fork lookalike stays green; the PR remains blocked.
   Repeat with head workflow tampering, missing App credentials and a wrong App
   ID. Verify a fork workflow requesting `publication-validator` cannot obtain
   its secret because it is not running from permitted main.
6. For maintenance, capture a labeled authorized staging run, remove the label
   and rerun that old run. Repeat by revoking the staging writer's permission.
   The dedicated App must report failure. Repeat removal during a queued run.
7. Repeat with the native required-workflow rule if evaluating the organization
   option: keep its selected trusted workflow pending and run the lookalike;
   the required workflow identity remains unsatisfied regardless of job names.

Local tests exercise stale-event/live-permission handling, exact-head reporting,
credential/source separation and the malicious fixture's shape. They do **not**
emulate GitHub ruleset enforcement, environment secret delivery, App token minting,
or merge decisions. The hosted acceptance sequence above has not been run.
