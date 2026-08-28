// The only place the document model and the stored markdown meet.

import MarkdownIt from 'markdown-it'
import TurndownService from 'turndown'

// `html: true` carries `<u>` through; `breaks: true` stops every note
// collapsing into one paragraph on first open.
const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: false,
  typographer: false
})

// Syntax the editor has no node for, which would otherwise be dropped on load
// and written away on the next save. Must agree with the disabled StarterKit.
md.disable([
  'hr',
  'table',
  'code',
  'fence',
  'reference',
  'lheading',
  'backticks',
  'strikethrough',
  'link',
  'image',
  'autolink'
])

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  br: ''
})

// Verbatim: turndown unwraps tags it does not know, losing the underline.
turndown.keep(['u'])

// Turndown escapes everything that could begin markdown syntax, but half is no
// longer parsed back in, so escaping it writes backslashes nobody typed.
const escapeText = TurndownService.prototype.escape
turndown.escape = (text: string): string =>
  escapeText(text)
    .replace(/\\([`[\]~=])/g, '$1')
    // A run of dashes is a rule to turndown but three dashes to this parser.
    .replace(/^\\(-{3,})/gm, '$1')

// Unwrapped only when the paragraph is the item's whole content, so an item
// holding several blocks keeps the spacing that separates them.
turndown.addRule('singleParagraphListItem', {
  filter: (node) =>
    node.nodeName === 'P' &&
    node.parentNode?.nodeName === 'LI' &&
    node.parentNode.childNodes.length === 1,
  replacement: (content) => content
})

export function markdownToHtml(markdown: string): string {
  return md.render(markdown)
}

export function htmlToMarkdown(html: string): string {
  // These would otherwise grow on every save.
  return turndown.turndown(html).replace(/\s+$/, '')
}
