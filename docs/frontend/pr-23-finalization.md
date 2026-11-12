# PR #23 finalization — 2026-11-12

Continues `feat/archive-frontend-overhaul` from
`f780c356741763713bee6c3a92886c0db999a277`. The four existing implementation
commits and visual design are retained. No replacement PR, merge, deployment,
secret change, Cloudflare dashboard change or production submission is part of
this work.

## Navigation fixes

- Back/Forward captures the outgoing view before replacing its DOM, keyed by
  history entry. Scroll and focus changes are also saved to history, with scroll
  writes limited to one per 500 ms. Restoration suppresses intermediate events
  and cancels stale animation frames. Recreated headings become focusable again.
- A course's selected resource type belongs to its history entry. Returning,
  going Forward and reloading restore it without applying it to other courses.
  A type absent from a changed catalog falls back to all resources.
- `/` navigates with search as the intended focus target and focuses it in the
  same keyboard event, so the scheduled restoration keeps it ready for typing.

Three new Chromium tests reproduced all three findings on the original branch
(three failures), then passed with the fixes. They include repeated traversal
with changed positions, scrolling immediately before traversal, recreated focus
targets, filter reload/return/isolation, and immediate typing from course/About.
History contains only navigation data, never draft field values or credentials.
The `?course=...`, search and track URL contracts are unchanged.

## Repository configuration and routing

| Service | Repository setting |
| --- | --- |
| Frontend | `https://archive.rootamman.com`; static `site/`, no hostname-specific routing |
| API base | `site/js/config.mjs`: `https://api.rootamman.com` |
| Worker custom domain | `worker/wrangler.jsonc`: `api.rootamman.com`, `custom_domain: true` |
| Allowed frontend origins | `https://archive.rootamman.com,https://root-archive.pages.dev` |
| Worker fallback | Existing `workers_dev: true` retained |
| Public R2 base | `https://pub-7a7ae5ec96bb46c7829a25b4b06407eb.r2.dev`, unchanged and equal to `moderation.config.json` |

Before modification, Wrangler had no checked-in custom-domain route. The added
route expresses the desired mapping to the existing `root-archive-worker`;
it does not prove that Cloudflare currently maps that hostname to this Worker.

The actual handler in `worker/worker.ts` accepts `POST /` and `POST /submit` for
uploads and `POST /auth/verify` for sign-in verification, with OPTIONS on each.
The frontend submits to the API base (the browser sends `/`) and constructs
`/auth/verify` from that base. No `/api` prefix or endpoint rewrite is needed.
The existing CORS implementation already parses comma-separated explicit origins;
no authentication or security runtime change was necessary.

The URL audit found the active old Worker base only in frontend config and the
old Pages origin in Wrangler. Historical deployment URLs and preview examples
in `docs/pages-previews.md` remain intact. They describe distinct deployments
and preview controls, not frontend API destinations. No global URL replacement
or R2 migration was performed.

## Turnstile warning assessment

The existing server-side integration posts `secret`, `response`, and optional
`remoteip` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. It
requires an HTTP success and JSON `success: true` before any upload or GitHub
mutation. It retains its 15-second timeout. The frontend sends the widget token
as the existing `turnstile_token` multipart field and resets it after submission.
The API hostname does not change the Siteverify endpoint or this contract.

Rendering the widget alone does not call Siteverify. `/auth/verify`, rejected
origins, failed Google authentication, invalid metadata/files and missing challenge
tokens all return before Siteverify. An eligible, valid submission must reach
that stage for a server-side verification to be observed.

No missing Siteverify call was found in source. The dashboard warning is
consistent with no observed successful verification requests, but that cause is
**not proven**. An old deployed Worker, CORS/routing failure, incorrect widget
hostname or mismatched secret/site key could also prevent successful verification.
Tests use mocked Siteverify and cannot clear or explain a live dashboard warning.
No second verification mechanism or change to the security model was introduced.

## Validation

Node 24.22.1, Python 3.12.14 and system Chromium. Dependency installation used
the committed lockfiles (`npm ci --ignore-scripts --no-audit --no-fund` and
`npm ci --prefix worker --no-audit --no-fund`, with cache `/tmp/archive-npm-cache`).

| Command | Result |
| --- | --- |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:frontend` | 15 passed; includes the existing optional screenshot-export test, no new screenshots requested |
| `WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=/tmp/archive-xdg npm --prefix worker run check` | Typecheck, dry-run bundle, 53 tests passed |
| `node scripts/catalogs.mjs` | 127 courses, 0 resources |
| `node --test scripts/*.test.mjs` | 27 passed |
| `python3 -m unittest discover -s analytics/tests -v` | 5 passed |
| `python3 -m unittest discover -s scripts/tests -v` | 3 passed |
| `python3 analytics/generate.py --count 200 --seed 42 --output analytics/output/events.jsonl` | 200 synthetic events |
| `python3 analytics/analyze.py analytics/output/events.jsonl --output analytics/output/report` | Passed |
| `/tmp/actionlint .github/workflows/*.yml scripts/fixtures/spoof-publication-check.yml` | Passed; v1.7.7 archive SHA-256 checked against CI's pinned checksum |
| `git diff --check` | Passed |

Browser tests run the actual frontend in Chromium. For both frontend hostnames,
all site files are served from loopback and GIS, Turnstile and API requests are
intercepted. They verify shareable course URLs/reload, literal API destinations,
POST methods, bearer headers and multipart fields without live-service traffic.
Existing responsive/accessibility, draft retention, expiry and upload-error checks
also pass. No browser rendering or interaction is mocked.

Worker tests use the checked-in origin configuration, signed synthetic Google
tokens and mocked upstreams. They exercise both origins on authentication and
both upload paths, preflight/error CORS headers, rejected lookalikes/previews,
R2-base synchronization, exactly one Siteverify call per validated submission,
and rejected/transport/HTTP/malformed Siteverify responses before storage or
moderation writes. The complete existing local workerd/emulated R2, upload,
cleanup, publication-policy and concurrent-catalog suites pass. These results
do not establish production service behavior.

## Live limits and owner verification before release

The owner reports Pages is connected and external service settings are updated.
Those dashboard facts were not independently verified in this session. Read-only
GET probes of `https://api.rootamman.com/auth/verify` and
`https://archive.rootamman.com/?course=0401212` both failed at the environment's
outbound proxy with `403 CONNECT tunnel failed`; neither yielded an origin
response. The enforced network allowlist does not include these hosts, and no
Cloudflare credentials or dashboard tools are available here. DNS existence,
deployed Worker mapping, TLS, CORS and live authentication remain unverified.

Before releasing the frontend API switch, the owner should:

1. Confirm Workers & Pages maps `api.rootamman.com` as an active custom domain
   to `root-archive-worker` in the intended environment, with valid TLS. A DNS
   record alone is insufficient. Confirm the deployed handler accepts the paths
   above. Apply the reviewed Worker configuration through the separately
   authorized release process before serving the updated frontend.
2. Verify deployed `ALLOWED_ORIGIN` includes both origins exactly. For each
   frontend Origin, OPTIONS to `/`, `/submit` and `/auth/verify` with requested
   method POST and headers `authorization,content-type` should return 200 and
   `Access-Control-Allow-Origin` equal to that one origin. An unauthenticated
   POST to `/auth/verify` should return 401 with the permitted origin's CORS
   header. Unlisted origins must receive 403 without a CORS grant.
3. Verify both frontends' JavaScript origins remain permitted for the unchanged
   Google client. Confirm the unchanged Turnstile widget permits
   `archive.rootamman.com` and the retained `root-archive.pages.dev` frontend,
   and that the deployed secret belongs to that widget. Keep secret values out
   of reports. The widget runs on the frontend hostname, not the API hostname.
4. Through an owner-approved staging test, verify real Google sign-in and one
   valid, fresh, single-use Turnstile token reach Siteverify successfully before
   upload, then check dashboard observations. Retain only sanitized status/error
   evidence. Inspect live configuration if valid attempts still produce the
   warning; a mocked success is insufficient to dismiss it.
5. Verify course links on the real custom hostname and complete the approved
   upload/review/publication lifecycle, retaining the current R2 public base.
   Existing [publication enforcement](../publication-enforcement.md) and
   [Pages preview controls](../pages-previews.md) remain release prerequisites.

Real GIS/Turnstile iframes, live R2/GitHub permissions, Safari/Firefox and
screen-reader checks remain owner verification. No production integration or
release readiness is claimed from local tests.
