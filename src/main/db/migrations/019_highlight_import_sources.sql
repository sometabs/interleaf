-- Calibre supplies a UUID; Kindle does not. Keep one source-aware identity so
-- every importer can prevent repeat imports without adding a column per app.
ALTER TABLE note ADD COLUMN import_source TEXT;
ALTER TABLE note ADD COLUMN import_key TEXT;

UPDATE note
SET import_source = 'calibre', import_key = calibre_uuid
WHERE calibre_uuid IS NOT NULL;

CREATE UNIQUE INDEX idx_note_import_identity
  ON note (import_source, import_key)
  WHERE import_source IS NOT NULL AND import_key IS NOT NULL;

-- The source key is Calibre's numeric book id or a hash of Kindle's title and
-- author header. Matches remain manual and disappear with the library book.
CREATE TABLE imported_book (
  source      TEXT NOT NULL,
  source_key  TEXT NOT NULL,
  book_id     INTEGER NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  linked_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (source, source_key)
);

INSERT INTO imported_book (source, source_key, book_id, linked_at)
SELECT 'calibre', CAST(calibre_id AS TEXT), book_id, linked_at
FROM calibre_book;
