-- Existing receipts remain evidence of copyright permission only.
ALTER TABLE contributor_authorizations ADD COLUMN privacy_consent_version TEXT;
ALTER TABLE contributor_authorizations ADD COLUMN privacy_consent_text TEXT
  CHECK (
    (privacy_consent_version IS NULL AND privacy_consent_text IS NULL)
    OR (privacy_consent_version IS NOT NULL AND privacy_consent_text IS NOT NULL
        AND length(trim(privacy_consent_version)) > 0 AND length(trim(privacy_consent_text)) > 0)
  );
