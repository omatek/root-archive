# Post-launch UX refinements

The directory filters the complete normalized course catalog before dividing it
into pages of 20. The status reports the visible range and total matching
courses. Empty results report 0–0 of 0; navigation is hidden for zero or one
page. Page numbers clamp to the available range; invalid values start at page 1.

`page` joins the existing query parameters, for example
`?q=a&track=CS&page=2`. The default page is omitted. Search, track and materials
changes reset page 1 using the existing replace-state behavior. Explicit page
changes create history entries and focus/scroll to the course results heading.
Course, About, reload and Back/Forward navigation retain page/filter state and
the existing per-entry focus/scroll restoration. Track buttons keep their toggle
group semantics and active styles in one horizontally scrollable row. Native
Tab/Shift+Tab focus brings offscreen buttons into view.

The contribution dialog displays two separate, required, initially unchecked
choices, with inline links to the Privacy Notice and Contributor Declaration.
Privacy consent is now `1.1-2026-11-16`. The canonical notice contains the exact
short accepted sentence followed by the unchanged processing/transfer details;
operator identity, data categories, purposes, providers, retention and withdrawal
disclosures remain available there. Regenerate the notice and shared consent
snapshot with `node scripts/build-policies.mjs`.

The backend already imports this shared snapshot: it requires the current
version and persists the server-owned accepted text with the verified identity,
file hash, original revision, submission event and timestamp. An older open
frontend must reload before submitting to an updated backend. No migration or
receipt rewrite is needed. Historical text/version pairs (including pre-privacy
null pairs) remain immutable. Contributor Declaration text/version is unchanged.
A later authorized release should deliver the updated frontend and moderation
bundle together. This PR performs no deployment or production data/configuration
changes.

About retains its community description, structure and contribution action,
using the requested independence statement and linked primary/backup contacts.
Other canonical legal policies are unchanged.

Verification uses local Chromium with mocked external services and local
workerd/D1/R2. Historical consent fixtures are synthetic and do not contain
actual contributor records. These checks do not establish live production
behavior.

## Local validation

Executed with Node 24.22.1, Python 3.12.14 and system Chromium:

| Command | Result |
| --- | --- |
| `node scripts/catalogs.mjs` | 127 courses, 0 static resources |
| `node scripts/build-policies.mjs --check` | Generated artifacts match |
| `node --test scripts/*.test.mjs` | 73 passed |
| `XDG_CONFIG_HOME=/tmp/root-archive-config WRANGLER_SEND_METRICS=false npm --prefix worker run check` | Typecheck, both dry-run bundles, 78 tests passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium SCREENSHOT_DIR=/tmp/root-archive-review node --test tests/frontend/*.test.mjs` | 44 passed, including accessibility and screenshots |
| `python3 -m unittest discover -s analytics/tests -v` | 5 passed |
| `python3 -m unittest discover -s scripts/tests -v` | 3 passed |
| `git diff --check` | Passed |

No implementation blockers remain. Review and an authorized coordinated release
of the frontend and backend consent snapshot remain human actions. Production
services were not exercised.
