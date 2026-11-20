const OPS = 'http://www.idpf.org/2007/ops'
const NOTE_TYPES = ['noteref', 'biblioref', 'glossref']
const NOTE_ROLES = ['doc-noteref', 'doc-biblioref', 'doc-glossref']
const INLINE = 'a, span, sup, sub, em, strong, i, b, small, big'

const words = (value: string | null): string[] => (value ?? '').split(/\s+/).filter(Boolean)

function raised(element: Element | null): boolean {
  if (!element) return false
  if (element.matches('sup')) return true
  const view = element.ownerDocument.defaultView
  const align = view ? view.getComputedStyle(element).verticalAlign : ''
  return align === 'super' || align === 'top' || align === 'text-top'
}

// A bare marker such as 1, [12], (a), * or †: what a note reference looks like in print.
const MARKER = /^[[(]?(\d{1,3}|[a-z]|[*†‡§¶]{1,3})[\])]?$/i

// Marked as a note by the book, raised like a printed note number, or only a marker.
export function isNoteReference(a: Element): boolean {
  const types = words(a.getAttributeNS(OPS, 'type'))
  const roles = words(a.getAttribute('role'))
  if (types.some((t) => NOTE_TYPES.includes(t)) || roles.some((r) => NOTE_ROLES.includes(r))) {
    return true
  }
  if (types.includes('backlink') || roles.includes('doc-backlink')) return false
  if (MARKER.test((a.textContent ?? '').trim())) return true
  return raised(a) || (a.children.length === 1 && raised(a.children[0])) || raised(a.parentElement)
}

const TARGET_TYPES = ['footnote', 'endnote', 'rearnote', 'note']
const TARGET_ROLES = ['doc-footnote', 'doc-endnote', 'doc-rearnote', 'note']

// What the link points at, when the book says that is a note.
export function isNoteTarget(target: Element | Range | null): boolean {
  let element: Element | null =
    target && 'startContainer' in target ? target.commonAncestorContainer.parentElement : target
  for (let depth = 0; element && depth < 4; depth++, element = element.parentElement) {
    if (element.matches('aside')) return true
    const types = words(element.getAttributeNS(OPS, 'type'))
    const roles = words(element.getAttribute('role'))
    if (
      types.some((t) => TARGET_TYPES.includes(t)) ||
      roles.some((r) => TARGET_ROLES.includes(r))
    ) {
      return true
    }
  }
  return false
}

const MAX_NOTE = 1500

// Plain text only: a note's markup never reaches the app window, so nothing in it can run.
export function noteText(target: Element | Range | null): string {
  if (!target) return ''
  let element: Element | null =
    'startContainer' in target ? target.commonAncestorContainer.parentElement : target
  while (
    element?.matches(INLINE) &&
    element.parentElement &&
    element.parentElement !== element.ownerDocument.body
  ) {
    element = element.parentElement
  }
  if (!element) return ''
  const copy = element.cloneNode(true) as Element
  for (const back of copy.querySelectorAll('a')) {
    const types = words(back.getAttributeNS(OPS, 'type'))
    const roles = words(back.getAttribute('role'))
    if (types.includes('backlink') || roles.includes('doc-backlink')) back.remove()
  }
  const text = (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.length > MAX_NOTE ? `${text.slice(0, MAX_NOTE).trimEnd()}…` : text
}
