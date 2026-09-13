-- A work identifies the text; an edition pins the language, title and jacket
-- the reader actually saw. Existing shelf rows are filled on their next
-- metadata refresh. Candidates are a cache, so force the new shape to be
-- harvested rather than pairing old work-level covers with edition titles.
ALTER TABLE book ADD COLUMN edition_olid TEXT;
ALTER TABLE book_candidate ADD COLUMN edition_olid TEXT;
ALTER TABLE book_candidate ADD COLUMN isbn TEXT;
ALTER TABLE book_candidate ADD COLUMN page_count INTEGER;
ALTER TABLE book_candidate ADD COLUMN published_year INTEGER;

DELETE FROM book_candidate;
