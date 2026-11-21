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

An online Discover search uses subjects and author names from finished books rated four stars or
more. **Find books like this** uses the selected book alone. A search plans up to eight catalogue
queries. Interleaf runs catalogue requests one at a time with at least 1.1 seconds between starts
and can retry once on `429` or `503`.

Ranking uses subjects and descriptions from the local candidate cache. Ratings go in half stars,
and each half star weighs between its neighbours. Finished three-star books give a weaker positive
signal, and ratings below three stars can push down similar results. Keyword
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
`interleaf.db`, its `covers/` directory, and attached EPUBs in `books/`, each named by a hash of
its contents so the same file is never kept twice.

**Data → Back up** writes a dated folder such as `interleaf-backup-2026-11-20-1430` holding a
SQLite snapshot, referenced covers, and attached EPUBs. **Data → Restore** takes that folder.
Interleaf saves the current library as an automatic backup first, verifies the chosen database,
upgrades a staged copy if needed, and restarts with the restored library. Shelf names, positions,
stacks, face-out covers, hidden books, bookmarks, and reading time are part of the database. UI
preferences, reader settings, the embedding model, and the embedding cache are stored separately.

**Data → Export as Markdown** writes `interleaf-markdown-…` with one file per book and per loose
note, plus covers. It is meant for reading in other apps and can't be restored.

Interleaf takes the first automatic backup after a saved change. Further changes are backed up
once the 24-hour window ends, or at the next launch if the app was closed at that point. It also
backs up right before any bulk delete in **Data** and before a restore. The three newest verified
snapshots are kept, by default in the profile's `backups/` folder; **Change folder…** under
Automatic backups moves them elsewhere. Snapshots share one `books/` folder for EPUBs, and a file
is removed once no snapshot needs it. If the database is missing or damaged at startup, Interleaf
offers to restore the newest snapshot or start an empty library, and keeps a copy of a damaged
database either way.

Discover thumbnails are removed once no cached recommendation uses them.

## Reading and writing

- Press `Ctrl + N` to add a book or `Esc` to go back.
- Reviews and edits to saved notes and quotes autosave. Press **Done** to save a new note or quote.
- Reading duration counts calendar days between your start and finish dates. Stats include page
  counts for finished books that have one. Monthly charts use finish dates.
- Time read counts only time in the Interleaf reader: the gaps between page turns, scrolls and
  keys, each capped at three minutes, and nothing while the window is hidden. Visits shorter than
  20 seconds aren't kept.
- In the reader, press `Ctrl + D` to bookmark a page and the arrow keys or `Page Up`/`Page Down`
  to turn pages.

## Development

Run `npm test` for the test suite, `npm run lint` for lint checks, and `npm run typecheck` for
TypeScript checks.
