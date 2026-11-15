# Legal operations for the private release

Internal procedure for Omar Khaldoon Jaber Tahrawi as operator. Use the existing
private moderation portal, protected API and restricted provider consoles. This
procedure is documented for release; it has not been executed or established as
an operating production routine by this task. No new case system is required.
Before real intake, start a private daily reminder and a minimal private record
of due actions. If daily coverage cannot be maintained, pause intake using the
existing control. Do not put correspondence, identities or live records in Git.

## Daily moderation and deletion

Review every page of the Pending queue (including under-review and unpublished
items). Use `created_at` for the 30-day undecided limit, not the latest edit.
Decide within that limit or reject with a short expiry reason. The one-hour
interrupted-upload cleanup is a different rule. Initial resources are original
student-authored academic work; apply the existing content policy to the exact
revision, without an institutional approval process.

Apply verified withdrawal through Unpublish promptly to revoke fresh downloads;
use permanent Remove within seven days of withdrawal. Unpublish alone retains
the private file and does not satisfy deletion. Reject/Remove scrub submission
identity and queue files; they preserve the separate permission receipt. Use
those actions rather than deleting public catalog rows or R2 objects directly.
Record withdrawal time and deletion deadline so later edits do not reset them.

Reject/Remove/Approve attempt a bounded cleanup automatically. If work remains, use the portal’s **Retry pending file cleanup** button. It calls
the existing authenticated `POST /admin/api/cleanup` with an empty JSON object
on the administrator origin. It is available independently of the scheduled
cleanup flag; no Cron is configured. It handles at most five due revisions per
call and scans a bounded object page. A response with zero processed is not
proof that every file is deleted. In restricted D1/R2 views, check the relevant
revision statuses, `delete_after`, `last_delete_error` and object absence. Retry
after the recorded deadline (storage failures schedule a five-minute retry),
and continue until all due files are accounted for. Resolve a backlog before
the seven-day file deadline; pause intake if capacity is insufficient.
Preserve revision tombstones and cleanup cursor state for late-upload recovery.

## Records, correspondence and provider copies

Review due dates daily; a private calendar or existing task list is sufficient.
At rejection or removal, schedule contributor-receipt deletion for 24 months later. At each
final moderation action schedule audit expiry for 24 months later. At complaint
resolution schedule correspondence deletion for 12 months later. A specific
unresolved dispute or legal hold needs its reason, affected records and next
review date recorded; it is not a reason to retain unrelated files indefinitely.

The protected detail API retrieves the copyright permission and privacy consent recorded in the contributor receipt. It has no purge route.
Use the restricted D1 console for due record deletion: inspect the exact IDs,
current status, last action and holds first. Delete expired rows from
`contributor_authorizations` (DELETE is supported; UPDATE is intentionally
blocked) and `moderation_audit` under their separate clocks. Never delete a
receipt while its resource remains published/authorized. Clear expired personal
moderation data also copied into `submissions.decided_by`/`reason`,
`resources.published_by` and `file_revisions.created_by`; use a neutral nonpersonal
marker for required text fields. Preserve active publication, receipt references,
revocation rows, revision IDs/object keys/statuses and cleanup state. Record only
minimal completion evidence. This is a manual lifecycle, not an implemented
purge job. Do not bulk-delete submissions or cascade away safety tombstones.

Delete resolved correspondence and unnecessary attachments, including trash,
at the 12-month deadline, subject to a specific hold. Before intake, establish
actual mailbox/forwarding providers and their backup lifecycle, and configure
application/security logs, Access records and traces to at most 30 days wherever
configurable. Production D1 Time Travel is seven days on Workers Free or 30 on
Paid; identify any separate exports or backups and their deletion lifecycle.
After a restore, reapply removals, withdrawals and expired-record deletion before
reopening service. Do not promise instant erasure from provider backups.

## Requests and urgent reports

Monitor privacy@rootamman.com and omar@rootamman.com daily; both already work.
For each request keep only receipt time, reference, necessary contact/authority
information, due date, action and outcome. Use minimum identity verification;
never request passwords or Google credentials. Apply the existing takedown
procedure and record any withdrawal requiring moderator action. Stop processing that relies on contributor privacy consent after verifying a withdrawal. Apply the applicable Unpublish, Reject or Remove action and keep limited evidence only while there is a separate lawful basis for retention.

Use the prior assessment's deadlines: rights requests within 15 working days
from the day after receipt, with only the permitted justified extension and
notice; privacy complaints within 10 days. For a qualifying serious-harm breach,
Article 20 specifies notice within 24 hours to affected people and 72 hours to
the Unit. These are retained legal duties from the existing assessment, not a
new legal determination about a hypothetical incident. Respond sooner where
needed to contain harm. Record resolution and its retention deadline.
