// Book pages render in frames that share the app's origin, so nothing in them may run.
// The Content Security Policy blocks scripts too; this removes them before they get there.
const ACTIVE_ELEMENTS =
  'script, iframe, frame, frameset, object, embed, applet, form, base, meta[http-equiv]'
const PAGE_TYPES = new Set(['application/xhtml+xml', 'text/html', 'image/svg+xml'])

export function isPage(type: string): boolean {
  return PAGE_TYPES.has(type)
}

/** Takes out what `inertPage` takes out, so places in the book point where they do on screen. */
export function removeActiveElements(doc: Document): Document {
  for (const element of doc.querySelectorAll(ACTIVE_ELEMENTS)) element.remove()
  return doc
}

export function inertPage(source: string, type: string): string {
  const doc = removeActiveElements(
    new DOMParser().parseFromString(source, type as DOMParserSupportedType)
  )
  for (const element of doc.querySelectorAll('*')) {
    for (const { name, value } of [...element.attributes]) {
      const lower = name.toLowerCase()
      const scriptUrl = /^\s*(javascript|vbscript|data:text\/html)/i.test(value)
      if (
        lower.startsWith('on') ||
        (scriptUrl && /(^|:)(href|src|action|xlink:href)$/.test(lower))
      ) {
        element.removeAttribute(name)
      }
    }
  }
  return type === 'text/html'
    ? `<!DOCTYPE html>${doc.documentElement.outerHTML}`
    : new XMLSerializer().serializeToString(doc)
}

// What each size keyword means at the browser's default of 16px.
const SIZE_KEYWORDS: Record<string, number> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48
}

/** A fixed font size as rem, which follows the reader's text size; null when already relative. */
export function relativeFontSize(value: string): string | null {
  const size = value.trim().toLowerCase()
  const unit = size.match(/^(\d*\.?\d+)(px|pt)$/)
  const px = SIZE_KEYWORDS[size] ?? (unit ? Number(unit[1]) * (unit[2] === 'pt' ? 4 / 3 : 1) : null)
  return px === null ? null : `${Math.round((px / 16) * 10000) / 10000}rem`
}

function relativeIn(style: CSSStyleDeclaration): void {
  const size = relativeFontSize(style.getPropertyValue('font-size'))
  if (size) style.setProperty('font-size', size, style.getPropertyPriority('font-size'))
}

// Keywords and px or pt ignore the reader's text size, which scales the root. Calibre scales
// the browser default instead, so such books grew there and not here.
export function followTextSize(doc: Document): void {
  const visit = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if ('selectorText' in rule) relativeIn((rule as CSSStyleRule).style)
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of doc.styleSheets) {
    try {
      visit(sheet.cssRules)
    } catch {
      // A sheet the frame may not read keeps its sizes.
    }
  }
  for (const element of doc.querySelectorAll<HTMLElement>('[style*="font-size"]')) {
    relativeIn(element.style)
  }
}
