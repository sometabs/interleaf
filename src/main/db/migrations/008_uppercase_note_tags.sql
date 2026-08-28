-- The stored value is the label itself, so without this every note tagged
-- before the change would read as untagged.
UPDATE note SET tag = upper(tag) WHERE tag IS NOT NULL;
