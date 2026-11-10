# Pages previews are a separate publication boundary

A submission PR includes its proposed catalog entry. Pages must not deploy that
branch publicly before review. Required GitHub checks protect merging; they do
not prevent an independent Pages Git integration from publishing previews.
Pending R2 objects remain intentionally public-read by direct URL. This policy
prevents a pending catalog from becoming a browsable archive preview; it does
not make uploads or public GitHub PRs private.

## Required owner settings — not applied by this task

In Cloudflare **Workers & Pages → root-archive → Settings → Builds & deployments**,
open the branch deployment controls and keep production on `main` with output
directory `site/`.
For prelaunch, **Preview branches: None** is the simplest safe choice.
If engineering previews are needed, select **Custom branches**, then set:

- **Exclude Preview branches:** `submission/*` and `submission-*` (legacy).
- **Include Preview branches:** only specific trusted development branches,
  such as `staging`; avoid `*`. A renamed pending submission must not escape
  into a broadly included branch prefix. Review before allowing another branch.

The corresponding source configuration fields are `preview_deployment_setting`
(`none` or `custom`), `preview_branch_excludes`, and `preview_branch_includes`.
Preserve the existing production configuration and any unrelated exclusions.
Save, reopen the settings, and record the actual values. Dashboard/API changes
require the owner's Cloudflare Pages project permissions.

[Cloudflare branch controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)
use native wildcard patterns; no new service is needed. The repository contains
only a **Worker** Wrangler configuration, no Pages project configuration or
Pages deploy workflow. Those Git integration branch controls are project
settings, not Worker `wrangler.jsonc` fields. No repository deployment setting
was invented or changed here. A build script supplied by the submission branch,
`robots.txt`/`noindex`, `_headers`, and hiding UI links are not substitutes.

## Existing deployment audit

Read-only GitHub Cloudflare check records on 2026-11-10 reported successful
previews for the following existing commits:

| PR | Commit prefix | Recorded hash URL |
| --- | --- | --- |
| #1, legacy submission | `f2f12d1` | `https://bb40e906.root-archive.pages.dev` |
| #2, legacy submission | `43e76d8` | `https://649bda35.root-archive.pages.dev` |
| #3, legacy submission | `e00be0d` | `https://c604ae7f.root-archive.pages.dev` |
| #22, engineering branch | `5b443a2` | `https://f8130ea6.root-archive.pages.dev` |

The records also list branch aliases. Legacy PRs were record-only, so their
successful builds do not establish that pending catalog entries were listed.
They do establish that those builds occurred. Current Cloudflare settings and a
complete deployment inventory were unavailable through the connected tools.
Direct anonymous `resources.json` checks were attempted on all four hash URLs
and the three legacy aliases. The web tool could not retrieve them, and a shell
probe was denied by the workspace outbound proxy (CONNECT 403), **not by a
verified Cloudflare access policy**. Anonymous reachability remains unverified.
No deployment was deleted or configuration altered.

The owner must audit **all** Pages preview deployments, with pagination, including
closed/deleted/renamed PR branches, not just the records above:

1. In Pages → Deployments, filter previews and record branch, commit, deployment
   ID, immutable hash URL and every branch/custom-domain alias. Read-only CLI
   inspection is also available with `wrangler pages deployment list
   --project-name root-archive --environment preview`; the dashboard/API inventory
   must cover all pages. Compare against open and historical submission PRs.
2. From an unauthenticated external client, check each URL's `/` and
   `/resources.json`. Record HTTP status/redirect destination and whether any
   unapproved submission appears. Do not copy student material into public logs.
3. Future exclusions do **not** remove old deployments. Neither closing a PR nor
   deleting/renaming its branch invalidates an immutable deployment hash URL.
   After owner approval, remove exposed previews where Cloudflare permits, or
   protect previews with an approved native Access policy and verify hash URLs
   **and aliases**. Cloudflare documents that the latest branch deployment cannot
   simply be deleted; do not assume an exclusion or a failed delete fixes it.
   Do not deploy replacement code or change production as an audit shortcut.

See [preview deployment lifetime/access/deletion](https://developers.cloudflare.com/pages/configuration/preview-deployments/).
Do not declare this finding resolved for live hosting until the existing URL
inventory has been checked and any exposure handled by the owner.

## Acceptance test: a pending PR produces no public preview

This is a concrete **owner-run staging test, not executed here**. Use a disposable
Pages project/repository and test-only Worker/R2 identity approved by the owner.
Apply the branch policy first, retain a read-only configuration/deployment export,
and use no real student data.

1. Record the staging production catalog and deployment inventory. Through the
   normal form, submit a uniquely named canary; record its UUID, PR, branch and
   exact head SHA. It must be pending/unmerged and absent from production.
2. Wait for ordinary CI and Pages integration processing to settle. Inventory
   **all preview deployments** again (dashboard or paginated Pages API). There
   must be **no deployment** for `submission/<uuid>`, its head SHA or its GitHub
   test-merge SHA. A missing GitHub check by itself is insufficient evidence.
3. Check the fresh branch alias from an unauthenticated client. For this code's
   UUID branch, Cloudflare's documented alias normalization gives
   `submission-<uuid>.<staging-project>.pages.dev`. Expect no public preview
   (typically 404); no public `resources.json` may list the canary. Confirm no
   new hash URL exists in the authoritative deployment inventory. Treat an
   unexpected 200 or unresolved/queued deployment as test failure, not success.
4. Push another harmless staging-only commit to that pending branch and repeat
   the inventory/alias checks. Reopening a staging PR must not bypass exclusions.
5. Repeat with a fresh disposable legacy `submission-<nonce>` branch/PR containing
   a synthetic proposed catalog addition. It must also create no preview and
   expose no public catalog. Under a Custom allowlist, repeat after renaming to
   an unlisted branch. Do not rename into a deliberately allowed branch.
6. If previews are enabled for engineering, use a separate trusted, explicitly
   included staging branch as a positive control: its preview should build.
   With Preview None, expect none. After separate staging review/merge approval,
   verify only the approved main catalog is published through production Git
   integration; never merge a real pending submission as a configuration test.
7. Audit the **existing** hash URLs and aliases in the same session. Disabling new
   builds without addressing an old exposed URL is an incomplete result.

Useful read-only evidence after setting staging variables:

```sh
STAGING_REPO=owner/disposable-repository
STAGING_PR=17
STAGING_PROJECT=disposable-pages-project
submission_uuid=replace-with-canary-uuid
gh pr view "$STAGING_PR" --repo "$STAGING_REPO" --json headRefName,headRefOid,state,mergedAt
gh api "repos/$STAGING_REPO/pulls/$STAGING_PR" --jq '{head:.head.sha,test_merge:.merge_commit_sha}'
wrangler pages deployment list --project-name "$STAGING_PROJECT" --environment preview
curl -sS -D - -o /dev/null "https://submission-$submission_uuid.$STAGING_PROJECT.pages.dev/resources.json"
```

For the read-only Pages API, inspect the project and every page of
`GET /accounts/{account_id}/pages/projects/{project_name}/deployments?env=preview`;
compare `deployment_trigger.metadata.branch` and `commit_hash` plus all aliases.
Use an already configured read credential; do not share tokens in chat/logs.
Keep the canary PR unmerged until the no-preview assertions are complete.
This acceptance test and the live branch exclusions remain owner actions.
