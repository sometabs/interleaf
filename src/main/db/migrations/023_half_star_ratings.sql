-- The INTEGER column already stores 3.5 as a real, and its CHECK keeps 1 to 5,
-- so half stars need only this rule instead of rebuilding the book table.
CREATE TRIGGER book_rating_half_steps_insert BEFORE INSERT ON book
WHEN new.rating IS NOT NULL AND new.rating * 2 <> CAST(new.rating * 2 AS INTEGER)
BEGIN
  SELECT RAISE(ABORT, 'A rating must be a whole or half star.');
END;

CREATE TRIGGER book_rating_half_steps_update BEFORE UPDATE OF rating ON book
WHEN new.rating IS NOT NULL AND new.rating * 2 <> CAST(new.rating * 2 AS INTEGER)
BEGIN
  SELECT RAISE(ABORT, 'A rating must be a whole or half star.');
END;
