import { Placeholder } from '@tiptap/extensions'
import type { Extensions } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

// Must agree with the disabled parser rules in `./markdown`: a node the editor
// cannot make is dropped on load and written away on the next save.
export function noteExtensions(placeholder = 'Start writing…'): Extensions {
  return [
    StarterKit.configure({
      // Only what the toolbar offers: bold, italic, underline, headings, lists
      // and quotes.
      horizontalRule: false,
      code: false,
      codeBlock: false,
      strike: false,
      link: false
    }),
    Placeholder.configure({ placeholder })
  ]
}

// No typed shortcuts: `# ` and `**x**` would be markdown by another name.
// Formatting goes through the toolbar, and typed characters stay as typed.
export const NOTE_TYPING = {
  enableInputRules: false,
  enablePasteRules: false
} as const
