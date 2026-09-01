-- A quote is a passage from a book. Unattached ones were a staging state that
-- nothing prompted you to finish, so they become notes rather than disappear.
UPDATE note SET kind = 'thought' WHERE kind = 'highlight' AND book_id IS NULL;
