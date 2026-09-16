-- Priority is now the order of the whole want-to-read shelf, not an optional
-- subset. Preserve any order already chosen and append the remaining books.
WITH
  base AS MATERIALIZED (
    SELECT coalesce(max(priority_position), 0) AS last_position
    FROM book
    WHERE status = 'want'
  ),
  missing AS MATERIALIZED (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS offset
    FROM book
    WHERE status = 'want' AND priority_position IS NULL
  )
UPDATE book
SET priority_position = (
  SELECT base.last_position + missing.offset
  FROM base, missing
  WHERE missing.id = book.id
)
WHERE status = 'want' AND priority_position IS NULL;
