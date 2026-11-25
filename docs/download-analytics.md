# Download analytics

The moderation portal’s **Analytics** view reports successful public `GET /download/:id` responses. It counts direct public links and repeat requests. HEAD availability checks, failed requests and private file previews leave the counters unchanged. The metric measures responses initiated, so interrupted transfers and automated requests can count.

Each published resource starts with zero. Its counter stays with the resource ID through edits, file replacements, unpublication, republication and permanent removal. Historical totals include withdrawn resources. The permanently removed title remains scrubbed. Course totals use each resource’s current course assignment and show a separate subtotal for resources currently published.

The Worker writes one atomic increment to D1 after it constructs a valid response, using the request’s background execution context. Write failures leave the download available and emit a generic failure event. Public catalog responses omit the counter. The private analytics endpoint uses the existing Access and administrator allowlist gate.

## Release and verification

1. Check the target database and its migration ledger, and verify its existing recovery point. Apply the pending migrations in order through `0006_resource_download_analytics.sql`. The migration adds a default-zero column and limits catalog invalidation to publication fields. Its recorded application time is the baseline shown in Analytics. Counts start when the matching Worker begins serving traffic.
2. Deploy the Worker and its matching admin assets, preserving the existing environment bindings, routes, Access settings and cleanup schedule. Validate on the isolated staging bindings first. Publish the generated Privacy Notice through the existing production Pages release procedure.
3. In the moderation portal, record a published resource’s baseline count. Confirm that an anonymous HEAD leaves it unchanged. Make one anonymous GET to the same public link, refresh Analytics and verify the count increases by one. Record the time, resource ID and one verification increment. Confirm that the public catalog omits the counter and the public host rejects the analytics URL.

The migration is forward-compatible with the previous Worker. A Worker rollback leaves already recorded counts in D1.
