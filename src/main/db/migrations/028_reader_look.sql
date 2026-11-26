-- In the database so a restored library opens books the way they were set up.
CREATE TABLE reader_look (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  look TEXT NOT NULL CHECK (json_valid(look))
);
