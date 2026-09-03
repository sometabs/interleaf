-- Calibre's own id for a highlight. Re-importing the same export then adds
-- nothing, however much the passage or its note was edited afterwards.
ALTER TABLE note ADD COLUMN calibre_uuid TEXT;

CREATE UNIQUE INDEX idx_note_calibre_uuid
  ON note (calibre_uuid) WHERE calibre_uuid IS NOT NULL;

-- An export carries book ids and no titles, so the match is made by hand once
-- and remembered.
CREATE TABLE calibre_book (
  calibre_id INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  linked_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
