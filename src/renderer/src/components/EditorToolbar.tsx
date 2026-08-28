import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import type { ReactNode } from 'react'

import { NOTE_TAGS } from '@shared/noteTags'

import { FONT_SIZES, setNoteFontSize, useNoteFontSize, type FontSizeId } from '../lib/fontSize'

interface Props {
  editor: Editor | null
  /** Omitted where a note-level label makes no sense, such as a book review. */
  tag?: string | null
  onTagChange?: (tag: string | null) => void
}

/** Markdown allows six, but three is enough depth for a reading note. A deeper
 *  one is still shown when a note already has it. */
const LEVELS = [0, 1, 2, 3]

function labelFor(level: number): string {
  return level === 0 ? 'Body' : `Heading ${level}`
}

export default function EditorToolbar({ editor, tag, onTagChange }: Props): ReactNode {
  const fontSize = useNoteFontSize()

  /** Re-renders when one of these answers changes, not on every keystroke. */
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null
      const heading = LEVELS.slice(1).find((level) => instance.isActive('heading', { level }))
      return {
        heading: heading ?? (instance.isActive('heading') ? -1 : 0),
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        underline: instance.isActive('underline'),
        bulletList: instance.isActive('bulletList'),
        orderedList: instance.isActive('orderedList'),
        blockquote: instance.isActive('blockquote')
      }
    }
  })

  if (!editor || !state) return <div className="mb-2 h-9 border-b border-hairline" />

  function setLevel(level: number): void {
    if (!editor) return
    const chain = editor.chain().focus()
    if (level === 0) chain.setParagraph().run()
    else chain.setHeading({ level: level as 1 | 2 | 3 }).run()
  }

  // A heading deeper than the picker offers can only come from a note written
  // elsewhere. Showing it beats snapping the select to a level it is not on.
  const levels = LEVELS.includes(state.heading) ? LEVELS : [...LEVELS, state.heading]

  function button(
    label: string,
    hint: string,
    active: boolean,
    run: () => void,
    glyph: string,
    style = ''
  ): ReactNode {
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        title={hint}
        // Without this the click blurs the editor first, which drops the caret
        // out of view and makes the button feel like it did nothing.
        onMouseDown={(event) => event.preventDefault()}
        onClick={run}
        className={`h-7 min-w-7 rounded-control px-1.5 text-[13px] leading-none transition-colors ${style} ${
          active ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-hover'
        }`}
      >
        {glyph}
      </button>
    )
  }

  const select =
    'h-7 rounded-control border-none bg-transparent px-1.5 text-[13px] text-ink-muted hover:bg-hover focus:outline-none'

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-hairline pb-2">
      <select
        aria-label="Paragraph style"
        title="Paragraph style"
        value={state.heading}
        onChange={(event) => setLevel(Number(event.target.value))}
        className={select}
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {level < 0 ? 'Heading' : labelFor(level)}
          </option>
        ))}
      </select>

      <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline" />

      {button(
        'Bold',
        'Bold (Ctrl+B)',
        state.bold,
        () => editor.chain().focus().toggleBold().run(),
        'B',
        'font-bold'
      )}
      {button(
        'Italic',
        'Italic (Ctrl+I)',
        state.italic,
        () => editor.chain().focus().toggleItalic().run(),
        'I',
        'font-serif italic'
      )}
      {button(
        'Underline',
        'Underline (Ctrl+U)',
        state.underline,
        () => editor.chain().focus().toggleUnderline().run(),
        'U',
        'underline underline-offset-2'
      )}

      <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline" />

      {button(
        'Bulleted list',
        'Bulleted list',
        state.bulletList,
        () => editor.chain().focus().toggleBulletList().run(),
        '•'
      )}
      {button(
        'Numbered list',
        'Numbered list',
        state.orderedList,
        () => editor.chain().focus().toggleOrderedList().run(),
        '1.'
      )}
      {button(
        'Quote',
        'Quote',
        state.blockquote,
        () => editor.chain().focus().toggleBlockquote().run(),
        '❝'
      )}

      <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline" />

      {/* A reading preference rather than formatting, which is why it sits
          after the divider and applies to every note rather than this one. */}
      <select
        aria-label="Font size"
        title="Font size, applied to every note"
        value={fontSize}
        onChange={(event) => setNoteFontSize(event.target.value as FontSizeId)}
        className={select}
      >
        {FONT_SIZES.map((size) => (
          <option key={size.id} value={size.id}>
            {size.label}
          </option>
        ))}
      </select>

      {onTagChange && (
        <>
          <span className="flex-1" />
          <select
            aria-label="Note tag"
            title="What kind of note is this?"
            value={tag ?? ''}
            onChange={(event) => onTagChange(event.target.value || null)}
            className={`${select} ${tag ? 'bg-accent-soft text-accent' : ''}`}
          >
            <option value="">No tag</option>
            {NOTE_TAGS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
