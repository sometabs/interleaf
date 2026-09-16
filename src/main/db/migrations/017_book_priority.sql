-- A priority queue is an ordered subset of the want-to-read shelf.
-- Null means the book is not in the queue.
ALTER TABLE book ADD COLUMN priority_position INTEGER;

CREATE INDEX idx_book_priority
ON book (priority_position)
WHERE priority_position IS NOT NULL;
