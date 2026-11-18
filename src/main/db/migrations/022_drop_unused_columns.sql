-- Migration 019 copied Calibre matches and highlight ids into imported_book and note.import_key.
DROP TABLE calibre_book;
DROP INDEX idx_note_calibre_uuid;
ALTER TABLE note DROP COLUMN calibre_uuid;

-- Genre labels lost their picker and are no longer read anywhere.
ALTER TABLE book DROP COLUMN genres;
