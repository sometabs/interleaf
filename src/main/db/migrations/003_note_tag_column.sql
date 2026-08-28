-- No CHECK on the values: the list lives in `shared/noteTags.ts`, and a
-- constraint here would make adding a word a schema migration.

ALTER TABLE note ADD COLUMN tag TEXT;

DROP TABLE IF EXISTS book_tag;
DROP TABLE IF EXISTS note_tag;
DROP TABLE IF EXISTS tag;
DROP TABLE IF EXISTS link;
