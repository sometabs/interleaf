-- The app's own state, which is not derivable from the library. Dropped again
-- in 013 along with the Status screen that read it.
CREATE TABLE app_setting (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
