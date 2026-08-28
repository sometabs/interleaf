-- Settings the main process needs to read, which localStorage cannot provide.
-- Dropped again in 011 along with the screen that wrote to it.
CREATE TABLE IF NOT EXISTS preference (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
