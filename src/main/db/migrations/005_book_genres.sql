-- On `book`, not `book_metadata`: that table is a cache rewritten by every
-- enrichment. Null means the reader has not chosen any filing labels.
ALTER TABLE book ADD COLUMN genres TEXT;
