-- Track durable library changes, including changes made in transactions.
CREATE TABLE library_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL
);
INSERT INTO library_revision VALUES (1, '');
