-- On `book`, not `book_metadata`: that table is a cache rewritten by every
-- enrichment. Null leaves the inference from subjects in charge.
ALTER TABLE book ADD COLUMN genres TEXT;
