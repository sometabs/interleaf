-- A popularity signal for the "By genre" mode, which had no shelf to rank
-- against. Dropped again in 011 along with that mode.
ALTER TABLE book_candidate ADD COLUMN edition_count INTEGER;
