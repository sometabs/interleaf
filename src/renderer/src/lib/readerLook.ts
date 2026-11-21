export type ReaderTheme = 'auto' | 'light' | 'sepia' | 'dark'
export type ShownTheme = Exclude<ReaderTheme, 'auto'>
export type ReaderFont = 'book' | 'serif' | 'sans'
export type ReaderFlow = 'paginated' | 'scrolled'
export type PageCount = 'left' | 'position'

export interface ReaderLook {
  theme: ReaderTheme
  font: ReaderFont
  size: number
  spacing: number
  width: number
  flow: ReaderFlow
  // Pages side by side in the paginated layout; a narrow window shows one regardless.
  pages: 1 | 2
  pageCount: PageCount
}

export const DEFAULT_LOOK: ReaderLook = {
  theme: 'auto',
  font: 'book',
  size: 100,
  spacing: 1.5,
  width: 680,
  flow: 'paginated',
  pages: 2,
  pageCount: 'left'
}

export const LIMITS = {
  size: { min: 70, max: 300, step: 10 },
  spacing: { min: 1.1, max: 2.2, step: 0.1 },
  width: { min: 440, max: 1040, step: 60 }
} as const

interface Theme {
  label: string
  background: string
  text: string
  // App colours redefined for the reader's panels; light and dark use the app's own.
  colors?: Record<string, string>
}

export const THEMES: Record<ShownTheme, Theme> = {
  light: { label: 'Light', background: '#fbfaf7', text: '#2d2926' },
  sepia: {
    label: 'Sepia',
    background: '#f4ecd8',
    text: '#4a3b2a',
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
  dark: { label: 'Dark', background: '#1c1b1a', text: '#dcd6cc' }
}

const FONTS: Record<Exclude<ReaderFont, 'book'>, string> = {
  serif: 'Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
  sans: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
}

export const THEME_CHOICES: ReaderTheme[] = ['auto', 'light', 'sepia', 'dark']

// Auto follows the app between light and dark; sepia is only ever a deliberate choice.
export function shownTheme(theme: ReaderTheme, appDark: boolean): ShownTheme {
  if (theme !== 'auto') return theme
  return appDark ? 'dark' : 'light'
}

const clamp = (value: number, { min, max }: { min: number; max: number }): number =>
  Math.min(max, Math.max(min, value))

export function parseLook(raw: unknown): ReaderLook | null {
  if (!raw || typeof raw !== 'object') return null
  const look = raw as Partial<ReaderLook>
  return {
    theme: look.theme && THEME_CHOICES.includes(look.theme) ? look.theme : DEFAULT_LOOK.theme,
    font: look.font === 'serif' || look.font === 'sans' ? look.font : 'book',
    size: clamp(Number(look.size) || DEFAULT_LOOK.size, LIMITS.size),
    spacing: clamp(Number(look.spacing) || DEFAULT_LOOK.spacing, LIMITS.spacing),
    width: clamp(Number(look.width) || DEFAULT_LOOK.width, LIMITS.width),
    flow: look.flow === 'scrolled' ? 'scrolled' : 'paginated',
    pages: look.pages === 1 ? 1 : 2,
    pageCount: look.pageCount === 'position' ? 'position' : 'left'
  }
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

// Light keeps the book's own colours; sepia and dark recolour text so it stays readable.
export function bookCss(look: ReaderLook, shown: ShownTheme): string {
  const theme = THEMES[shown]
  const recolour =
    shown === 'light'
      ? ''
      : `
    html, body, body * { color: ${theme.text} !important; background-color: transparent !important; }
    a, a * { color: ${shown === 'dark' ? '#9fb6da' : '#8a5a2b'} !important; }`
  const font =
    look.font === 'book'
      ? ''
      : `
    body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${FONTS[look.font]} !important; }`
  return `
    html { color-scheme: ${shown === 'dark' ? 'dark' : 'light'}; background: transparent !important; font-size: ${look.size}% !important; }
    p, li, blockquote, dd, div { line-height: ${look.spacing} !important; }
    pre { white-space: pre-wrap !important; }
    img, svg, video { max-width: 100%; height: auto; }${recolour}${font}`
}

// A reflowing book has no fixed pages: print page numbers when it carries them, else count
// within the chapter, either what is left or where you are.
export function pageLabel(
  printed: string | null,
  screen: number,
  screens: number,
  columns: number,
  scrolled: boolean,
  count: PageCount = 'left'
): string {
  if (printed?.trim()) return `Page ${printed.trim()}`
  // The paginator pads each chapter with a blank screen at both ends.
  const content = screens - 2
  if (scrolled || content <= 0) return ''
  const perScreen = Math.max(1, columns)
  if (count === 'position') {
    const current = Math.min(content, Math.max(1, screen))
    return `${(current - 1) * perScreen + 1} / ${content * perScreen} in chapter`
  }
  const left = Math.max(0, content - screen) * perScreen
  if (left === 0) return 'Last page in chapter'
  return `${left} ${left === 1 ? 'page' : 'pages'} left in chapter`
}
