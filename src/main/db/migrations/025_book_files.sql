-- One EPUB per book, stored under its hash so the same file is never kept twice.
CREATE TABLE book_file (
  book_id   INTEGER PRIMARY KEY REFERENCES book (id) ON DELETE CASCADE,
  sha256    TEXT    NOT NULL UNIQUE CHECK (length(sha256) = 64),
  file_name TEXT    NOT NULL,
  size      INTEGER NOT NULL CHECK (size > 0),
  added_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Kept apart from book_file: it changes on every page turn and must not trigger backups.
CREATE TABLE reading_position (
  book_id    INTEGER PRIMARY KEY REFERENCES book_file (book_id) ON DELETE CASCADE,
  cfi        TEXT    NOT NULL,
  fraction   REAL    NOT NULL CHECK (fraction BETWEEN 0 AND 1),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Where in the book's EPUB a quote or note was taken from.
ALTER TABLE note ADD COLUMN location TEXT;
