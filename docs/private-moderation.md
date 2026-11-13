# Private moderation migration

Work is on `feat/private-moderation`. This is a staged replacement, not an
approved production cutover. The legacy Worker/configuration, publication App,
required checks and static public catalog remain operational until release.

## Architecture

Keep Pages and the static course catalog. A separate moderation Worker owns D1
and a **new private R2 bucket**, serves the administrator assets and same-origin
administrator API, and exposes a read-only public catalog and download API.
`admin.rootamman.com` is the intended administrator origin; `api.rootamman.com`
is the intended public API origin after an approved cutover. Staging uses
different names and storage. No private files or administrator assets are placed
in `site/` or GitHub submission PRs.

Access protects the entire administrator hostname. The Worker additionally
verifies its signed Access JWT (issuer, audience, algorithm, expiration), checks
an explicit email allowlist and exact administrator origin, and requires a
same-origin custom header on writes. Static assets pass through that check too.
There is no development authentication bypass. Alternate Worker/preview hosts
are disabled in the new configuration and rejected by application routing.

All files, including approved files, remain private. Public URLs contain only a
stable resource UUID. Every download consults publication state in primary D1
and streams the selected immutable R2 revision. Responses prohibit caching; no
signed object URLs or public R2 endpoints are used. Unpublishing revokes the URL
and keeps files for private review. Permanent removal revokes it and durably
queues deletion. Already downloaded copies cannot be recalled; a download that
started before revocation may finish. Serving each new request through D1/R2
costs more requests and latency than cached public assets, in return for access
revocation. Do not add a cache without revisiting this guarantee.

Metadata/file changes are private candidates. Publishing atomically updates a
separate D1 public snapshot only after R2 confirms the immutable candidate.
Optimistic record versions prevent stale administrator writes. Durable upload
intents and deletion state make interrupted cross-service work recoverable.
The replacement never writes submission PRs or needs a GitHub credential.

## Read-only account observations — 13 November 2026

- Pages `root-archive` serves `site/` from `main`; canonical deployment SHA is
  `4bb136b9a39423737be4ee30ba1239d735e221c9`. Its catalog is empty, as is current
  `main`'s `site/resources.json`. This is source/deployment provenance, not an
  authenticated live contribution test.
- Legacy Worker `root-archive-worker` is a dashboard deployment with compatibility
  date `2025-02-01`. Its workers.dev and version previews are enabled. Its
  production bindings still use public `root-archive-assets` and GitHub.
- That legacy bucket has enabled r2.dev and `assets.rootamman.com` endpoints and
  four historical objects. None were downloaded, changed or deleted.
- Pages has 44 deployments, including 32 previews and eight successful historical
  submission previews. Current submission-branch exclusions do not revoke old
  previews. Historical links require a separate owner-approved disposition.
- Access apps/organization reads return `access.api.error.not_enabled`.
  Enabling Zero Trust, choosing a team and identity method, setting administrator
  addresses and policies are owner actions. Cloudflare's setup documentation
  requires plan selection/payment details even for its Free option. No plan or
  Access policy was enabled here. Account billing APIs are unavailable to the
  OAuth connection, so no paid entitlement is assumed.

## Isolated infrastructure prepared

Account `1b409400fea16e7142f62ac19ecd361d`:

| Resource | Name / identifier | Status |
| --- | --- | --- |
| D1 | `root-archive-moderation-staging`, `f4aa2a8b-4b27-4ed3-b7a2-4e6e100a94c6` | EEUR; read replication disabled |
| R2 | `root-archive-private-staging` | EEUR Standard; r2.dev disabled; no custom domains |

Creation did not subscribe to a paid plan, deploy a Worker, add routing/DNS,
change Access, or touch production. Empty staging resources fit documented Free
allowances (D1 10 databases, 5 GB total; Standard R2 10 GB-month). Usage quotas
are account-wide, and future storage/traffic must be monitored by the owner.

See [Cloudflare Zero Trust setup](https://developers.cloudflare.com/cloudflare-one/setup/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/), and
[Worker-first assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).

## Repository visibility recommendation

Keep `omatek/root-archive` public through this migration. Administrator security
does not depend on source privacy. After private moderation, privacy provides
limited security value while reducing community transparency and introducing a
plan dependency. Visibility was not changed.

The repository belongs to a **personal** account. Its actual billing plan could
not be read through the available connection. GitHub Free supports repository
rulesets for public repositories; a private personal repository needs **Pro**
for these protections. If the account already has Pro (including an eligible
benefit), no extra subscription may be necessary. Confirm before changing.

Observed active ruleset `26518493` has no bypasses, requires PRs (zero approvals),
resolved threads, up-to-date branches and these source-bound checks:

| Check | App integration ID |
| --- | --- |
| Submission policy | 5734145 (`root-archive-publication`) |
| Repository / Worker / Frontend browser checks | 15368 (GitHub Actions) |
| Cloudflare Pages | 85455 |

The App is issuing checks. This does not verify environment secret restrictions
or hostile-workflow enforcement; those settings were inaccessible. The legacy
branch-protection endpoint returned an integration-permission 403.

Actions and installed Apps support private repositories, subject to installation
access and private CI budgets. Environment branch restrictions would also need
the appropriate private-repository plan. Cloudflare Pages supports private GitHub
repositories; no Cloudflare paid plan is inherently necessary for that switch.
Verify a nonproduction build after any future approved visibility change.

No public forks or releases were observed. Four sampled CI runs contained no
uploaded artifacts; exhaustive artifacts and account billing were inaccessible.
Previously obtained clones, downloads, old public R2 URLs, Pages previews and
deployed browser source remain independent of repository visibility. Closing a
PR or making the repository private is not a content takedown. Public browsing
reads Pages catalogs rather than raw GitHub; the footer source link is the main
public-source dependency. The old Worker already authenticates its GitHub calls.

Sources: [repository](https://api.github.com/repos/omatek/root-archive),
[ruleset](https://github.com/omatek/root-archive/rules/26518493),
[ruleset plans](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[environment availability](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[Pages integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/),
[visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
