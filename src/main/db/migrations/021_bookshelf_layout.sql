CREATE TABLE bookshelf_layout (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  layout TEXT NOT NULL CHECK (json_valid(layout))
);
