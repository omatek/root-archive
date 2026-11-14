-- Private moderation only. Never apply this migration to the legacy public bucket.
PRAGMA foreign_keys = ON;

CREATE TABLE submissions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  course_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('Practice Questions','Summary','Notes','Test Bank','Other')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
  semester TEXT NOT NULL DEFAULT '' CHECK(length(semester) <= 20),
  contributor TEXT CHECK(contributor IS NULL OR length(contributor) <= 80),
  contributor_sub TEXT,
  contributor_email TEXT,
  status TEXT NOT NULL CHECK(status IN ('receiving','pending','under_review','published','unpublished','rejected','removed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  original_revision_id TEXT,
  candidate_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decision_at TEXT,
  decided_by TEXT,
  reason TEXT,
  last_operation TEXT NOT NULL
);
CREATE INDEX submissions_queue ON submissions(status, created_at DESC, id);
CREATE INDEX submissions_course ON submissions(course_id, status);

CREATE TABLE file_revisions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  object_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('original','replacement')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 26214400),
  etag TEXT,
  status TEXT NOT NULL CHECK(status IN ('uploading','ready','delete_pending','deleted')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  upload_deadline TEXT NOT NULL,
  delete_after TEXT,
  delete_attempts INTEGER NOT NULL DEFAULT 0,
  last_delete_error TEXT,
  deleted_at TEXT
);
CREATE INDEX revision_submission ON file_revisions(submission_id, created_at);
CREATE INDEX revision_cleanup ON file_revisions(status, delete_after, upload_deadline);

-- Published snapshot is deliberately distinct from the editable submission.
-- One stable public ID survives unpublish/review/republication. Revoked rows
-- remain private tombstones and are never returned by the public API.
CREATE TABLE resources (
  id TEXT PRIMARY KEY REFERENCES submissions(id),
  course_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('Practice Questions','Summary','Notes','Test Bank','Other')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
  semester TEXT NOT NULL DEFAULT '',
  contributor TEXT,
  revision_id TEXT REFERENCES file_revisions(id),
  status TEXT NOT NULL CHECK(status IN ('published','unpublished','removed')),
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT NOT NULL
);
CREATE INDEX resources_catalog ON resources(status, course_id, published_at DESC, id);

CREATE TABLE moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  action TEXT NOT NULL CHECK(action IN ('submission_received','review_started','file_replaced','metadata_changed','submission_approved','submission_rejected','resource_modified','resource_unpublished','resource_removed','upload_abandoned')),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT,
  operation_id TEXT NOT NULL UNIQUE
);
CREATE INDEX audit_submission ON moderation_audit(submission_id, id);

-- Resumable private object reconciliation also catches a PUT that completes
-- after its request was interrupted and its first cleanup attempt ran.
CREATE TABLE cleanup_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  cursor TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  scanned_at TEXT
);
INSERT INTO cleanup_state(singleton,cursor) VALUES(1,NULL);
