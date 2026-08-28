-- The name lived only in the candidate cache that 006 empties. Nullable: the
-- backfill recovers only rows whose candidate is still in the pool.
ALTER TABLE rec_feedback ADD COLUMN title TEXT;
ALTER TABLE rec_feedback ADD COLUMN author TEXT;

UPDATE rec_feedback
SET title = (SELECT c.title FROM book_candidate c WHERE c.olid = rec_feedback.olid),
    author = (SELECT c.author FROM book_candidate c WHERE c.olid = rec_feedback.olid)
WHERE title IS NULL;
