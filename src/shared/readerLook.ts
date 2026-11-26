export type ReaderTheme = 'auto' | 'light' | 'gray' | 'sepia' | 'dark' | 'black'
export type ShownTheme = Exclude<ReaderTheme, 'auto'>
export type ReaderFont = 'book' | 'serif' | 'sans'
export type ReaderFlow = 'paginated' | 'scrolled'
export type PageCount = 'left' | 'position'
export type ReaderAlign = 'book' | 'left' | 'justify'

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
  align: ReaderAlign
  // Space above and below the text, in CSS pixels.
  margin: number
  // Clicking the outer fifth of a page turns it.
  edgeTurn: boolean
}

export const DEFAULT_LOOK: ReaderLook = {
  theme: 'auto',
  font: 'book',
  size: 100,
  spacing: 1.5,
  width: 680,
  flow: 'paginated',
  pages: 2,
  pageCount: 'left',
  align: 'book',
  margin: 40,
  edgeTurn: true
}

export const LIMITS = {
  size: { min: 70, max: 300, step: 10 },
  spacing: { min: 1.1, max: 2.2, step: 0.1 },
  width: { min: 440, max: 1040, step: 60 },
  margin: { min: 0, max: 120, step: 10 }
} as const

export const THEME_CHOICES: ReaderTheme[] = ['auto', 'light', 'gray', 'sepia', 'dark', 'black']

export const clamp = (value: number, { min, max }: { min: number; max: number }): number =>
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
    pageCount: look.pageCount === 'position' ? 'position' : 'left',
    align: look.align === 'left' || look.align === 'justify' ? look.align : 'book',
    margin:
      typeof look.margin === 'number' ? clamp(look.margin, LIMITS.margin) : DEFAULT_LOOK.margin,
    edgeTurn: look.edgeTurn !== false
  }
}
