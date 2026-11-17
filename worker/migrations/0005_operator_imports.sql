-- Operator evidence is separate from genuine Google contributor authorizations.
-- Keep hash/operation tombstones after removal so replay never restores content.
CREATE TABLE operator_imports (
  operation_id TEXT PRIMARY KEY CHECK(length(operation_id)=36),
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  file_sha256 TEXT NOT NULL UNIQUE CHECK(length(file_sha256)=64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
  operator_email TEXT NOT NULL,
  attestation_version TEXT NOT NULL CHECK(attestation_version='operator-permission-v1'),
  attestation_text TEXT NOT NULL,
  attested_at TEXT NOT NULL,
  accepted_at TEXT,
  received_operation_id TEXT UNIQUE
);
-- Never allow public credit to be added to operator imports through moderation.
CREATE TRIGGER operator_import_no_credit_insert BEFORE INSERT ON operator_imports WHEN EXISTS(SELECT 1 FROM submissions WHERE id=NEW.submission_id AND (contributor IS NOT NULL OR contributor_sub IS NOT NULL OR contributor_email IS NOT NULL)) BEGIN SELECT RAISE(ABORT, 'Operator imports cannot claim contributor identity'); END;
CREATE TRIGGER operator_import_no_credit_update BEFORE UPDATE ON submissions WHEN EXISTS(SELECT 1 FROM operator_imports WHERE submission_id=OLD.id) AND (NEW.contributor IS NOT NULL OR NEW.contributor_sub IS NOT NULL OR NEW.contributor_email IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'Operator imports cannot claim contributor identity'); END;
