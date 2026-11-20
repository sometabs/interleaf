-- Tied to the file like the reading position: a place only makes sense in its own EPUB.
CREATE TABLE bookmark (
  id         INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL REFERENCES book_file (book_id) ON DELETE CASCADE,
  cfi        TEXT    NOT NULL,
  excerpt    TEXT    NOT NULL DEFAULT '',
  chapter    TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (book_id, cfi)
);
