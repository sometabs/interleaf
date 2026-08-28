import { EditorContent, useEditor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { noteExtensions, NOTE_TYPING } from '../lib/editor/extensions'
import { htmlToMarkdown, markdownToHtml } from '../lib/editor/markdown'
import { pixelsFor, useNoteFontSize } from '../lib/fontSize'
import EditorToolbar from './EditorToolbar'

interface Props {
  value: string
  placeholder?: string
  // Called after the debounce settles, and immediately on unmount.
  onSave: (value: string) => void
  className?: string
  // Omitted where a note-level label makes no sense.
  tag?: string | null
  onTagChange?: (tag: string | null) => void
}

const SAVE_DEBOUNCE_MS = 700

// Built once per mount and never rebuilt for a prop change, which would throw
// away the cursor and undo history. For another document, pass a new `key`.
export default function Editor({
  value,
  placeholder = 'Start writing…',
  onSave,
  className = '',
  tag,
  onTagChange
}: Props): ReactNode {
  const fontSize = useNoteFontSize()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<string | null>(null)

  // A save round-trips through the database and returns as a new `value`,
  // which without this reads as an outside edit.
  const emittedRef = useRef(value)

  // So an inline arrow from a parent is not a reason to rebuild the editor.
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  })

  const flush = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current !== null) {
      const text = pendingRef.current
      pendingRef.current = null
      onSaveRef.current(text)
    }
  }, [])

  // Captured once: reading `value` per render would make the editor depend
  // on it.
  const [initialHtml] = useState(() => markdownToHtml(value))

  const editor = useEditor({
    immediatelyRender: true,
    content: initialHtml,
    ...NOTE_TYPING,
    extensions: noteExtensions(placeholder),
    editorProps: { attributes: { class: 'note-prose' } },
    onUpdate: ({ editor: instance }) => {
      const markdown = htmlToMarkdown(instance.getHTML())
      emittedRef.current = markdown
      pendingRef.current = markdown
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS)
    }
  })

  useEffect(() => {
    return () => {
      flush()
    }
  }, [flush])

  // Never over unsaved keystrokes, and never when the markdown is what this
  // editor produced, which is what a save round-trip looks like.
  useEffect(() => {
    if (!editor || pendingRef.current !== null) return
    if (value === emittedRef.current) return
    emittedRef.current = value
    editor.commands.setContent(markdownToHtml(value), { emitUpdate: false })
  }, [editor, value])

  return (
    <div
      className={`flex h-full min-h-0 flex-col ${className}`}
      // Inherited by `.note-prose`, so the toolbar is not resized with it.
      style={{ '--note-font-size': `${pixelsFor(fontSize)}px` } as CSSProperties}
    >
      <EditorToolbar editor={editor} tag={tag} onTagChange={onTagChange} />
      <EditorContent
        editor={editor}
        data-testid="editor"
        className="min-h-0 flex-1 overflow-y-auto"
      />
    </div>
  )
}
