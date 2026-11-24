// The only place the document model and the stored markdown meet.

import MarkdownIt from 'markdown-it'
import TurndownService from 'turndown'

import { escapeMarkdownText } from '@shared/markdownText'

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
  'autolink',
  'html_block'
])

// The editor writes only these tags. Anything else in angle brackets is text the
// user typed, which would otherwise be swallowed as an unknown tag.
const OWN_TAG = /^<\/?(u|strong|em|b|i)>$/i
md.renderer.rules.html_inline = (tokens, index) => {
  const { content } = tokens[index]
  return OWN_TAG.test(content) ? content : md.utils.escapeHtml(content)
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  br: ''
})

// Markdown has no underline. Converted inside, so its text is escaped like any other.
turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`
})

// One rule for typed text, reader passages and imports alike.
turndown.escape = escapeMarkdownText

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
