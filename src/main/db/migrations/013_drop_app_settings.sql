-- 012 stays: a database that already ran it reports user_version 12, and
-- deleting a shipped migration would make that look like a downgrade.
DROP TABLE IF EXISTS app_setting;
