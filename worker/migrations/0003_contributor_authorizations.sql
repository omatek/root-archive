-- New submissions only: never infer acceptance for historical staging records.
-- Kept separately from scrubbed content tombstones as evidence of permission.
CREATE TABLE contributor_authorizations (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
  original_revision_id TEXT NOT NULL UNIQUE REFERENCES file_revisions(id),
  -- Snapshot the event ID without an audit FK: published permission evidence
  -- must be retainable longer than the audit's separate 24-month lifecycle.
  received_operation_id TEXT NOT NULL UNIQUE,
  contributor_sub TEXT NOT NULL,
  contributor_email TEXT NOT NULL,
  declaration_version TEXT NOT NULL,
  declaration_language TEXT NOT NULL,
  declaration_text TEXT NOT NULL,
  acceptance_method TEXT NOT NULL CHECK(acceptance_method = 'affirmative_checkbox'),
  public_credit TEXT,
  file_sha256 TEXT NOT NULL CHECK(length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
  accepted_at TEXT NOT NULL
);
-- Corrections cannot silently rewrite what a contributor accepted. DELETE is
-- intentionally available for the approved retention lifecycle.
CREATE TRIGGER contributor_authorizations_immutable BEFORE UPDATE ON contributor_authorizations BEGIN SELECT RAISE(ABORT, 'Contributor authorizations are immutable'); END;
