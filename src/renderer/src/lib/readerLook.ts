export type ReaderTheme = 'light' | 'sepia' | 'dark'
export type ReaderFont = 'book' | 'serif' | 'sans'
export type ReaderFlow = 'paginated' | 'scrolled'

export interface ReaderLook {
  theme: ReaderTheme
  font: ReaderFont
  size: number
  spacing: number
  width: number
  flow: ReaderFlow
  // Pages side by side in the paginated layout; a narrow window shows one regardless.
  pages: 1 | 2
}

export const DEFAULT_LOOK: ReaderLook = {
  theme: 'light',
  font: 'book',
  size: 100,
  spacing: 1.5,
  width: 680,
  flow: 'paginated',
  pages: 2
}

export const LIMITS = {
  size: { min: 70, max: 200, step: 10 },
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

export const THEMES: Record<ReaderTheme, Theme> = {
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

const clamp = (value: number, { min, max }: { min: number; max: number }): number =>
  Math.min(max, Math.max(min, value))

export function parseLook(raw: unknown): ReaderLook | null {
  if (!raw || typeof raw !== 'object') return null
  const look = raw as Partial<ReaderLook>
  return {
    theme: look.theme && look.theme in THEMES ? look.theme : DEFAULT_LOOK.theme,
    font: look.font === 'serif' || look.font === 'sans' ? look.font : 'book',
    size: clamp(Number(look.size) || DEFAULT_LOOK.size, LIMITS.size),
    spacing: clamp(Number(look.spacing) || DEFAULT_LOOK.spacing, LIMITS.spacing),
    width: clamp(Number(look.width) || DEFAULT_LOOK.width, LIMITS.width),
    flow: look.flow === 'scrolled' ? 'scrolled' : 'paginated',
    pages: look.pages === 1 ? 1 : 2
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

// Light keeps the book's own colours; sepia and dark recolour text so it stays readable.
export function bookCss(look: ReaderLook): string {
  const theme = THEMES[look.theme]
  const recolour =
    look.theme === 'light'
      ? ''
      : `
    html, body, body * { color: ${theme.text} !important; background-color: transparent !important; }
    a, a * { color: ${look.theme === 'dark' ? '#9fb6da' : '#8a5a2b'} !important; }`
  const font =
    look.font === 'book'
      ? ''
      : `
    body, body *:not(code):not(pre):not(kbd):not(samp) { font-family: ${FONTS[look.font]} !important; }`
  return `
    html { color-scheme: ${look.theme === 'dark' ? 'dark' : 'light'}; background: transparent !important; font-size: ${look.size}% !important; }
    p, li, blockquote, dd, div { line-height: ${look.spacing} !important; }
    pre { white-space: pre-wrap !important; }
    img, svg, video { max-width: 100%; height: auto; }${recolour}${font}`
}

// A reflowing book has no fixed pages: print page numbers when it carries them, else what is left.
export function pageLabel(
  printed: string | null,
  screen: number,
  screens: number,
  columns: number,
  scrolled: boolean
): string {
  if (printed?.trim()) return `Page ${printed.trim()}`
  // The paginator pads each chapter with a blank screen at both ends.
  const content = screens - 2
  if (scrolled || content <= 0) return ''
  const left = Math.max(0, content - screen) * Math.max(1, columns)
  if (left === 0) return 'Last page in chapter'
  return `${left} ${left === 1 ? 'page' : 'pages'} left in chapter`
}
