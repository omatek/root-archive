ALTER TABLE resources ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0 CHECK(download_count >= 0);

-- Preserve catalog invalidation for existing publication fields only.
DROP TRIGGER catalog_update;
CREATE TRIGGER catalog_update AFTER UPDATE OF id,course_id,type,title,semester,contributor,revision_id,status,published_at,updated_at,published_by ON resources BEGIN UPDATE catalog_state SET generation = lower(hex(randomblob(16))) WHERE singleton = 1; END;
