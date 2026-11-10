# Verified baseline — 2026-11-09

Repository: `omatek/root-archive`; default branch `main`.
Initial checkout `work` was clean and matched fetched remote `main` at
`96f1be66745222c0a86040f8040542c437f084c1`.

## Evidence and recovery

Inspected tree, manifests, Worker, frontend, catalogs, configuration, all local
refs/history/reflogs, `git fsck --full --no-reflogs`, remote heads/pull refs,
GitHub branches, all PR search results, and issue search results. The repository
contained ten baseline commits, no tests, no docs, no workflows, and no
`AGENTS.md`. Git object checking reported no dangling recovery candidates.

Neither `535b2ce` nor `34a59ac` resolved locally or through the GitHub commit
API (422: no commit found). `fix/submission-moderation` was not advertised.
Three existing submission branches/PRs (#1–#3) propose submission JSON records;
none contains the reported simplified moderation implementation. Student
submission metadata is deliberately not copied into documentation or fixtures.
Recovery is **P0**, not evidence that the implementation never existed elsewhere.
The historical claim of 45 passing tests cannot be verified here.

## Capability classification

| Capability | Baseline status / evidence |
| --- | --- |
| Course catalog | Implemented; locally parsed: 127 unique courses |
| Resource catalog | Implemented; locally parsed: empty array |
| Static UI / GIS / Turnstile wiring | Implemented, not browser/integration-tested |
| Google RS256 verification, issuer/audience, email_verified, expiry/age, exact email + hd domain | Implemented in source; signed-token integration untested |
| Explicit-origin CORS and HTTP rejection boundaries | Implemented; tests added by this task, separate from baseline |
| Multipart size, metadata and file signatures | Implemented in source; authenticated-path coverage absent |
| R2 upload and GitHub submission PR | Implemented, not locally integration-tested; existing PRs are limited historical evidence |
| Upload rollback | Attempts deletion on GitHub error; deletion error silently ignored; failure recovery untested |
| Catalog publication / protected existing entries | Planned but absent |
| Cron cleanup / approved-object protection | Planned but absent; no scheduled handler or trigger |
| Simplified moderation branch | Missing from accessible repository; recovery blocked by missing artifact |
| CI / dependency maintenance / docs | Absent at baseline; introduced on this feature branch |
| Live deployment, service health, credentials, bucket policy and branch protection | Unknown; not changed or verified |

Original package commands were only `dev`, `deploy`, and `check:bundle` in
`worker/package.json`. No baseline `npm test` or typecheck command existed.
Wrangler binds `BUCKET`, sets public service identifiers and one configured
Pages origin, and enables observability. Those are source configuration facts,
not proof of live state. `.gitignore` excluded every `README.md`; this task
removes that exclusion so documentation can be preserved.

## Scope of this implementation

Independent engineering and academic foundations only. `worker/worker.ts`,
`worker/wrangler.jsonc`, `site/*` and existing submission branches remain untouched.
HTTP tests import the dry-run bundle under Node, not workerd. Catalog validation
checks schema/integrity; it does not enforce moderation authorization, append-only
publication, branch file restrictions or protected-main compatibility.

New CI uses only `pull_request`, ordinary branch push, and manual dispatch with
read-only permissions and no secrets. A trusted-base publication-policy check
still belongs to P0 moderation recovery. New academic data is wholly synthetic;
the cloud measurement helper accepts only loopback URLs, including redirects.

GitHub issue creation and draft PR export are authorized for this task. No
connected GitHub Projects capability is available; no Project is claimed.
No production endpoint was probed, and no rollout, merge or deployment was done.
