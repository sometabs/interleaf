-- Undoes 009 and 010: Discover recommends from the library alone now, so
-- neither has a reader. Nothing dropped here is the reader's own work.
DROP TABLE IF EXISTS preference;

ALTER TABLE book_candidate DROP COLUMN edition_count;
