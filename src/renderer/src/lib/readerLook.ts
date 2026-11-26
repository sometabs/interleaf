import {
  clamp,
  LIMITS,
  type PageCount,
  type ReaderFont,
  type ReaderLook,
  type ReaderTheme,
  type ShownTheme
} from '@shared/readerLook'

export interface Theme {
  label: string
  background: string
  text: string
  dark: boolean
  // Links in the book, footnote markers included; null keeps the book's own.
  link: string | null
  // App colours redefined for the reader's panels; light and dark use the app's own.
  colors?: Record<string, string>
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]
}

/** `from` moved towards `to` by `amount`, from 0 (unchanged) to 1 (all the way). */
function mix(from: string, to: string, amount: number): string {
  const [a, b] = [rgb(from), rgb(to)]
  return `#${a
    .map((channel, index) => Math.round(channel + (b[index] - channel) * amount))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// What body text needs to be read comfortably.
export const READABLE = 4.5

// The text colour pulled towards blue, then back towards the text until it reads.
function linkColor(background: string, text: string): string {
  const dark = luminance(background) < 0.2
  let link = mix(text, dark ? '#8ab4f8' : '#1f5fbf', 0.6)
  for (let i = 0; i < 8 && contrast(link, background) < READABLE; i++) link = mix(link, text, 0.3)
  return link
}

// Every panel colour follows from the page and its text, so a theme is two colours.
function themeFrom(label: string, background: string, text: string): Theme {
  const dark = luminance(background) < 0.2
  const link = linkColor(background, text)
  return {
    label,
    background,
    text,
    dark,
    link,
    colors: {
      '--color-canvas': background,
      '--color-surface': mix(background, '#ffffff', dark ? 0.06 : 0.5),
      '--color-sunken': mix(background, text, 0.05),
      '--color-hover': mix(background, text, 0.08),
      '--color-hairline': mix(background, text, 0.14),
      '--color-hairline-strong': mix(background, text, 0.26),
      '--color-ink': text,
      '--color-ink-muted': mix(text, background, 0.3),
      '--color-ink-faint': mix(text, background, 0.5),
      '--color-accent': link,
      // Buttons keep the app's own fill, which already carries white text in light and dark.
      '--color-accent-soft': mix(background, link, 0.18)
    }
  }
}

export const THEMES: Record<ShownTheme, Theme> = {
  light: { label: 'Light', background: '#f6f3ee', text: '#2d2926', dark: false, link: null },
  gray: themeFrom('Gray', '#e9ecef', '#2b2f33'),
  sepia: {
    label: 'Sepia',
    background: '#f4ecd8',
    text: '#4a3b2a',
    dark: false,
    link: '#8a5a2b',
    colors: {
      '--color-canvas': '#f4ecd8',
      '--color-surface': '#fbf6ea',
      '--color-sunken': '#efe4cc',
      '--color-hover': '#ede1c6',
      '--color-hairline': '#e4d6b6',
      '--color-hairline-strong': '#d3c19c',
      '--color-ink': '#3f3122',
      '--color-ink-muted': '#6b5a45',
      '--color-ink-faint': '#93806a',
      '--color-accent': '#8a5a2b',
      '--color-accent-soft': '#efdfc2',
      '--color-action': '#8a5a2b',
      '--color-action-hover': '#744a22'
    }
  },
  dark: { label: 'Dark', background: '#1c1b1a', text: '#dcd6cc', dark: true, link: '#9fb6da' },
  black: themeFrom('Black', '#000000', '#c9c9c9')
}

/** The colours a loaded chapter reads, as variables: switching theme repaints, it reflows nothing. */
export function paintBook(doc: Document, theme: Theme): void {
  const root = doc.documentElement.style
  root.setProperty('--reader-text', theme.text)
  root.setProperty('--reader-link', theme.link ?? theme.text)
  root.setProperty('color-scheme', theme.dark ? 'dark' : 'light')
}

const FONTS: Record<Exclude<ReaderFont, 'book'>, string> = {
  serif: 'Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
  sans: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
}

// Auto follows the app between light and dark; sepia is only ever a deliberate choice.
export function shownTheme(theme: ReaderTheme, appDark: boolean): ShownTheme {
  if (theme !== 'auto') return theme
  return appDark ? 'dark' : 'light'
}

export type ReaderLayout = 'two' | 'one' | 'scroll'

export function layoutOf(look: ReaderLook): ReaderLayout {
  if (look.flow === 'scrolled') return 'scroll'
  return look.pages === 1 ? 'one' : 'two'
}

export function withLayout(look: ReaderLook, layout: ReaderLayout): ReaderLook {
  if (layout === 'scroll') return { ...look, flow: 'scrolled' }
  return { ...look, flow: 'paginated', pages: layout === 'one' ? 1 : 2 }
}

export function step(look: ReaderLook, key: keyof typeof LIMITS, direction: 1 | -1): ReaderLook {
  const limits = LIMITS[key]
  const next = Math.round((look[key] + direction * limits.step) * 100) / 100
  return { ...look, [key]: clamp(next, limits) }
}

// The widest text width that still changes the page: foliate fits the pages between 6% gaps.
export function widthRoom(look: ReaderLook, area: { width: number; height: number }): number {
  if (area.width <= 0) return Infinity
  const spread = area.height > area.width ? 1 : look.pages
  if (look.flow === 'scrolled') return area.width * (spread === 2 ? 0.88 : 0.94)
  return (area.width * 0.94) / spread
}

// Steps below the room, so a width the window had already capped narrows on the first press.
export function narrower(look: ReaderLook, room: number): ReaderLook {
  const { min, step: by } = LIMITS.width
  const fits = min + (Math.ceil((room - min) / by) - 1) * by
  const next = step(look, 'width', -1).width
  return { ...look, width: Math.max(min, Math.min(next, fits)) }
}

// Light keeps the book's colours except its page background; the others recolour all text.
// The colours themselves come from `paintBook`, so changing one does not lay the book out again.
export function bookCss(look: ReaderLook, shown: ShownTheme): string {
  const recolour =
    shown === 'light'
      ? ''
      : `
    html, body, body * { color: var(--reader-text) !important; background-color: transparent !important; }
    a, a * { color: var(--reader-link) !important; }`
  const font =
    look.font === 'book'
      ? ''
      : `
    body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${FONTS[look.font]} !important; }`
  const align =
    look.align === 'book'
      ? ''
      : `
    p, li, dd, blockquote { text-align: ${look.align} !important; }`
  return `
    html { background: transparent !important; font-size: ${look.size}% !important; }
    body { background-color: transparent !important; }
    p, li, blockquote, dd, div { line-height: ${look.spacing} !important; }
    pre { white-space: pre-wrap !important; }
    img, svg, video { max-width: 100%; height: auto; }${recolour}${font}${align}`
}

// A reflowing book has no fixed pages: count screens within the chapter, either what is left
// or where you are.
export function pageLabel(
  screen: number,
  screens: number,
  columns: number,
  scrolled: boolean,
  count: PageCount = 'left'
): string {
  // The paginator pads each chapter with a blank screen at both ends.
  const content = screens - 2
  if (scrolled || content <= 0) return ''
  const perScreen = Math.max(1, columns)
  if (count === 'position') {
    const current = Math.min(content, Math.max(1, screen))
    return `${(current - 1) * perScreen + 1} / ${content * perScreen}`
  }
  const left = Math.max(0, content - screen) * perScreen
  if (left === 0) return 'Last page'
  return `${left} ${left === 1 ? 'page' : 'pages'} left`
}
