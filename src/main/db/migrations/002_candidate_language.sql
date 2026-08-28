-- Not backfilled: that would cost one request per row. Those rows stay out of
-- Discover until a later harvest refreshes them.
ALTER TABLE book_candidate ADD COLUMN languages TEXT;
