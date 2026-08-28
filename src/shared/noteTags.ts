// The schema has no CHECK constraint, so growing this list is not a migration.
export const NOTE_TAGS = ['THEORY', 'SUMMARY'] as const

export type NoteTag = (typeof NOTE_TAGS)[number]

// Anything unrecognised reads as untagged, so a removed label cannot strand a
// note. Case is folded for vaults exported before they were capitalised.
export function asNoteTag(value: string | null | undefined): NoteTag | null {
  const upper = value?.trim().toUpperCase()
  return NOTE_TAGS.includes(upper as NoteTag) ? (upper as NoteTag) : null
}
