-- Time spent in the reader. Tied to the book, not its file: replacing the EPUB keeps the time read.
CREATE TABLE reading_session (
  id         INTEGER PRIMARY KEY,
  book_id    INTEGER NOT NULL REFERENCES book (id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  seconds    INTEGER NOT NULL CHECK (seconds > 0),
  UNIQUE (book_id, started_at)
);

CREATE INDEX reading_session_started ON reading_session (started_at);
