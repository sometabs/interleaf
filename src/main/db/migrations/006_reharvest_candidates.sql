-- Rows harvested before English edition titles were preferred kept their
-- original title. Safe: the table is a cache, and dismissals are elsewhere.
DELETE FROM book_candidate;
