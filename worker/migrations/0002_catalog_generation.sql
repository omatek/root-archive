-- Invalidate multi-page reads atomically with every published-snapshot change.
-- Tokens contain no private metadata and are not authentication credentials.
CREATE TABLE catalog_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  generation TEXT NOT NULL CHECK(length(generation) = 32)
);
INSERT INTO catalog_state VALUES(1, lower(hex(randomblob(16))));
CREATE TRIGGER catalog_insert AFTER INSERT ON resources BEGIN UPDATE catalog_state SET generation = lower(hex(randomblob(16))) WHERE singleton = 1; END;
CREATE TRIGGER catalog_update AFTER UPDATE ON resources BEGIN UPDATE catalog_state SET generation = lower(hex(randomblob(16))) WHERE singleton = 1; END;
CREATE TRIGGER catalog_delete AFTER DELETE ON resources BEGIN UPDATE catalog_state SET generation = lower(hex(randomblob(16))) WHERE singleton = 1; END;
