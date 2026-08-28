-- Interleaf initial schema.
-- SQLite is the source of truth; Markdown is an export format, not a mirror.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- books

CREATE TABLE book (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  author         TEXT,
  isbn           TEXT,
  olid           TEXT UNIQUE,           -- Open Library work id, e.g. OL27448W
  cover_path     TEXT,                  -- relative to the cover cache dir
  page_count     INTEGER,
  published_year INTEGER,
  status         TEXT    NOT NULL DEFAULT 'want'
                 CHECK (status IN ('want', 'reading', 'read', 'abandoned')),
  rating         INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  started_at     INTEGER,
  finished_at    INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_book_status ON book (status);
CREATE INDEX idx_book_rating ON book (rating);

-- ---------------------------------------------------------------- notes

-- All prose lives here: a book's review is a note with kind='review', so there
-- is one editor, one search index and one export path.
CREATE TABLE note (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id    INTEGER REFERENCES book (id) ON DELETE CASCADE,  -- nullable: free-floating thoughts
  kind       TEXT    NOT NULL DEFAULT 'thought'
             CHECK (kind IN ('review', 'thought', 'highlight')),
  title      TEXT    NOT NULL DEFAULT '',
  body_md    TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_note_book ON note (book_id);
CREATE INDEX idx_note_kind ON note (kind);

-- A book gets at most one review; thoughts and highlights are unbounded.
CREATE UNIQUE INDEX idx_note_one_review_per_book
  ON note (book_id) WHERE kind = 'review';

-- ---------------------------------------------------------------- tags

-- Free-form tags parsed out of note bodies. Dropped again in 003, which
-- replaced them with a single label per note.
CREATE TABLE tag (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,   -- normalized lowercase
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE note_tag (
  note_id INTEGER NOT NULL REFERENCES note (id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tag  (id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE book_tag (
  book_id INTEGER NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tag  (id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

CREATE INDEX idx_note_tag_tag ON note_tag (tag_id);
CREATE INDEX idx_book_tag_tag ON book_tag (tag_id);

-- ---------------------------------------------------------------- links

-- Backlinks parsed out of note bodies. Dropped again in 003.
CREATE TABLE link (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_note_id INTEGER NOT NULL REFERENCES note (id) ON DELETE CASCADE,
  to_book_id   INTEGER REFERENCES book (id) ON DELETE CASCADE,
  to_note_id   INTEGER REFERENCES note (id) ON DELETE CASCADE,
  target_text  TEXT    NOT NULL
);

CREATE INDEX idx_link_from ON link (from_note_id);
CREATE INDEX idx_link_to_book ON link (to_book_id);
CREATE INDEX idx_link_to_note ON link (to_note_id);

-- ---------------------------------------------------------- metadata cache

-- Open Library data for books in the library. Regenerable, never user-authored.
CREATE TABLE book_metadata (
  book_id     INTEGER PRIMARY KEY REFERENCES book (id) ON DELETE CASCADE,
  subjects    TEXT,      -- JSON array of strings
  description TEXT,
  raw_json    TEXT,
  fetched_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Books discovered as recommendation candidates that are NOT in the library.
CREATE TABLE book_candidate (
  olid         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  author       TEXT,
  subjects     TEXT,     -- JSON array of strings
  description  TEXT,
  cover_id     INTEGER,  -- Open Library cover id
  source       TEXT,     -- which subject/author harvest produced this
  harvested_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Dismissals keep rejected books from resurfacing and feed the scorer.
CREATE TABLE rec_feedback (
  olid   TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('dismissed', 'saved')),
  at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (olid, action)
);

-- ------------------------------------------------------------ full text

CREATE VIRTUAL TABLE note_fts USING fts5 (
  title,
  body_md,
  content = 'note',
  content_rowid = 'id',
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER note_fts_ai AFTER INSERT ON note BEGIN
  INSERT INTO note_fts (rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
END;

CREATE TRIGGER note_fts_ad AFTER DELETE ON note BEGIN
  INSERT INTO note_fts (note_fts, rowid, title, body_md)
    VALUES ('delete', old.id, old.title, old.body_md);
END;

CREATE TRIGGER note_fts_au AFTER UPDATE ON note BEGIN
  INSERT INTO note_fts (note_fts, rowid, title, body_md)
    VALUES ('delete', old.id, old.title, old.body_md);
  INSERT INTO note_fts (rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
END;

CREATE VIRTUAL TABLE book_fts USING fts5 (
  title,
  author,
  content = 'book',
  content_rowid = 'id',
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER book_fts_ai AFTER INSERT ON book BEGIN
  INSERT INTO book_fts (rowid, title, author) VALUES (new.id, new.title, new.author);
END;

CREATE TRIGGER book_fts_ad AFTER DELETE ON book BEGIN
  INSERT INTO book_fts (book_fts, rowid, title, author)
    VALUES ('delete', old.id, old.title, old.author);
END;

CREATE TRIGGER book_fts_au AFTER UPDATE ON book BEGIN
  INSERT INTO book_fts (book_fts, rowid, title, author)
    VALUES ('delete', old.id, old.title, old.author);
  INSERT INTO book_fts (rowid, title, author) VALUES (new.id, new.title, new.author);
END;
