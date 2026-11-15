# Library data and recommendations

For installation and a tour of Interleaf, see the [README](../README.md).

## Book metadata

When you add an Open Library result, Interleaf saves its displayed title, author, cover, and
edition identifiers where available. The initial page count uses the work-level median and falls
back to the selected edition's page count.

Metadata refresh uses the saved Open Library Work ID to update subjects and descriptions and fill
missing page counts and publication years. You can refresh one book or use **Data → Book
metadata** for the library.

## Discover

An online Discover search uses subjects and author names from finished books rated four or five
stars. **Find books like this** uses the selected book alone. A search plans up to eight catalogue
queries. Interleaf runs catalogue requests one at a time with at least 1.1 seconds between starts
and can retry once on `429` or `503`.

Ranking uses subjects and descriptions from the local candidate cache. Finished three-star books
give a weaker positive signal, and one- or two-star ratings can push down similar results. Keyword
ranking uses TF-IDF and cosine similarity. **Advanced recommendations** combines that ranking with
local embeddings using reciprocal rank fusion. Discover falls back to keyword ranking if the
model fails.

The first use of Advanced recommendations may download the roughly 35 MB BGE Small model.
Interleaf caches embeddings locally. The model is English-focused, so it can rank non-English
metadata less reliably. Reviews, notes, and quotes stay on your device.

## Where your data lives

- **Windows**: `%APPDATA%\Interleaf\`
- **Linux**: `$XDG_CONFIG_HOME/Interleaf/` or `~/.config/Interleaf/`

Source and preview builds use a separate `Interleaf Dev` directory. Each profile stores
`interleaf.db` and its `covers/` directory.

**Data → Export library** saves a SQLite snapshot, referenced covers, and a readable Markdown copy
in `interleaf-backup/`. Select the exported folder in **Data → Import**. Interleaf verifies the
database, upgrades a staged copy if needed, and restarts with the restored library. Shelf names,
positions, stacks, face-out covers, and hidden books are part of the database. UI preferences,
the embedding model, and the embedding cache are stored separately.

Interleaf takes the first automatic backup after a saved change. Further changes refresh it once
the 24-hour window ends, or at the next launch if the app was closed at that point. Interleaf
keeps one verified snapshot in the profile's `backups/` folder and refreshes it after a manual
import. If the database is missing or damaged at startup, it offers to restore that snapshot.

## Reading and writing

- Press `Ctrl + N` to add a book or `Esc` to go back.
- Reviews and edits to saved notes and quotes autosave. Press **Done** to save a new note or quote.
- Reading duration counts calendar days between your start and finish dates. Stats include page
  counts for finished books that have one. Monthly charts use finish dates.

## Development

Run `npm test` for the test suite, `npm run lint` for lint checks, and `npm run typecheck` for
TypeScript checks.
