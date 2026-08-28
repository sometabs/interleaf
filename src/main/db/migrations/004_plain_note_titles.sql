-- Fixing the derivation only heals a note on its next edit; this rewrites the
-- rest. `strip_markdown` is registered by `createDatabase` before this runs.

UPDATE note
SET title = strip_markdown(title)
WHERE title <> strip_markdown(title);
