# Frontend polish

This follow-up preserves PR #23's visual identity, social metadata/assets,
typography, course URLs and history restoration. The directory heading is
“Course directory”. About introduces root's broader purpose and root/archive as
its first public project, identifies initial AUM coverage, and retains the
independence disclaimer. The existing `assets/brand/root.svg` already reuses the
approved source sheet's exact geometry; no logo replacement was necessary.

## Sign-in and owner configuration

GIS initialization no longer sends `hd`. Any account can be chosen, subject to
Google-side settings. Only the Worker's verified `/auth/verify` response enables
local submission. The Worker still checks RS256 signatures, issuer, client
audience, timing, verified email, and exact `std.aum.edu.jo` email and hosted
domain on verification and every upload. No eligibility check was moved to the
browser. Tokens remain in memory; sign-out clears them without signing out of
Google itself or creating a persistent account.

An ineligible account gets a live-region explanation and a different-account
action. Switching/signing out cancels pending verification and invalidates late
responses. Expiry clears verification with a 30-second safety margin, including
on reopen after backgrounding. These actions retain the course, metadata and
selected file. Reloading/closing the tab still clears the draft, as disclosed.

Owner-only Google dashboard review (not performed here):

- In Google Auth Platform → Audience for the existing client project, inspect
  **Internal/External**. Internal blocks accounts outside the organization;
  External is needed to allow other Google accounts to complete sign-in.
- Inspect publishing status and requested scopes. Testing normally restricts
  users, but Google exempts basic Sign in with Google using only
  `openid`/email/profile. Do not assume a test-user change or publication is
  needed without checking the actual configuration and other requested scopes.
- Confirm the existing web client's authorized JavaScript origins include
  `https://archive.rootamman.com` and `https://root-archive.pages.dev`, and that
  its ID matches the frontend and Worker. This popup callback flow adds no new
  redirect route. Workspace administrator/account restrictions may still apply.

Repository code cannot reveal private dashboard settings. No dashboard change
is confirmed necessary, and none was made. Check a personal account's chooser
and rejection, then an eligible account's successful retry in approved staging.
Keep current custom domains, API routes, Worker authorization and scopes.

References checked 2026-11-13:
[GIS `hd` and sign-out methods](https://developers.google.com/identity/gsi/web/reference/js-reference),
[Google Audience and Testing exceptions](https://support.google.com/cloud/answer/15549945?hl=en),
[client/origin setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Resource contract and compatibility

The supported type strings, in display order, are **Practice Questions**,
**Summary**, **Notes**, **Test Bank**, **Other**. The singular `Summary` and
`Test Bank` values are unchanged; section headings pluralize them explicitly.
The contribution selector, normalized catalog, resource filters, Worker type
union/input validation and catalog/moderation validation all support these
values. Deprecated `Past Paper` and unknown types are rejected for new records.
File validation, Turnstile, receipt equality and immutable publication controls
are unchanged.

Inspected base: `99e29483d975c26ac02fba958c748f810b67c5bd` (PR #23 merged).
`site/resources.json` is empty and `submissions/` contains no published receipts,
so there is no published data to migrate or alias. Old test submission PRs are
outside this task. Before a later release, recheck current main for intervening
published records; do not rename immutable receipts or bypass moderation to
change existing records. Release the frontend, Worker and trusted base policy
together after owner review, so new types are accepted at every boundary.

## Materials-only directory filter

“Only courses with materials” is off by default. `hasMaterials=1` enables it;
other values (including an empty value) disable it. Like existing route fields,
the first duplicate wins. URL generation emits at most one canonical `1`, or
omits the parameter when off. An existing malformed URL is normalized on the
next filter/search update or generated navigation link, not on initial load.

The checkbox intersects search and track filters. Course, About and directory
links carry the selection; reload and Back/Forward restore it from the URL.
Filter changes replace the current directory history entry, following existing
search/track behavior. The labeled native checkbox supports Space and announces
results through the existing status region. The empty state explains how to
broaden results and clears all filters with one action.

Filtering uses `course.resources.length` from `parseCatalog`, not fetch URLs or
pending submission state. No successful contribution is inserted into the
catalog before moderation. The future D1 API can supply published records to
this same normalized structure and retain these type strings and URL semantics.
No D1 client, new R2 storage, account service, admin portal or data framework is
introduced; GitHub moderation and public-read R2 remain in place.

## Verification

Verified with Node 24.22.1, Python 3.12.14 and system Chromium:

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/archive-frontend-npm-cache` | Passed, 3 packages |
| `npm ci --prefix worker --no-audit --no-fund --cache /tmp/archive-worker-npm-cache` | Passed, 42 packages |
| `node scripts/catalogs.mjs` | Passed: 127 courses, 0 resources |
| `node --test scripts/*.test.mjs` | 31 passed, 0 failed |
| `WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=/tmp/archive-xdg npm --prefix worker run check` | Typecheck, dry-run bundle and 54 tests passed, 0 failed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium SCREENSHOT_DIR=/tmp/archive-polish-review npm run test:frontend` | 23 passed, 0 failed |
| `python3 -m unittest discover -s analytics/tests -v` | 5 passed |
| `python3 -m unittest discover -s scripts/tests -v` | 3 passed |
| `python3 analytics/generate.py --count 200 --seed 42 --output analytics/output/events.jsonl` | 200 synthetic events |
| `python3 analytics/analyze.py analytics/output/events.jsonl --output analytics/output/report` | Passed |
| `/tmp/archive-actionlint/actionlint .github/workflows/*.yml scripts/fixtures/spoof-publication-check.yml` | Passed, pinned v1.7.7 archive SHA-256 verified against CI |
| `git diff --check` | Passed |

Initial dependency installation failed because npm's default cache was outside
the writable workspace; both clean installs succeeded with the explicit `/tmp`
caches above. No package or lockfile changes were needed.

Review screenshots:
[desktop directory](screenshots/directory-desktop.png),
[mobile directory](screenshots/directory-mobile.png),
[About](screenshots/about-desktop.png),
[contribution with mocked services](screenshots/contribution-desktop-simulated.png),
[mobile contribution](screenshots/contribution-mobile-simulated.png).
The 320–1440px browser reflow checks and axe WCAG A/AA scans pass in the tested
states; screenshots were visually checked. Brand source/logo, fonts, social
assets, canonical URL and sharing metadata are unchanged from PR #23.

Browser tests
block external requests and mock GIS, Turnstile, Worker responses and resource
payloads. Worker tests use generated RSA keys, synthetic claims and mocked
upstreams; the workerd test uses local emulated R2. These are not live Google,
Cloudflare or GitHub integration tests. Real popup/FedCM behavior, account
restrictions, third-party iframe accessibility, screen readers, Safari/Firefox
and approved staging submission/moderation remain manual checks. No production
settings, secrets, infrastructure or deployments were changed.

Rollback requires a reviewed revert of frontend, Worker and policy changes
together; once real new-type resources are published, account for their type
compatibility before reverting validators. Do not rewrite catalog receipts.
