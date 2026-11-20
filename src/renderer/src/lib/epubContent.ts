// Book pages render in frames that share the app's origin, so nothing in them may run.
// The Content Security Policy blocks scripts too; this removes them before they get there.
const ACTIVE_ELEMENTS =
  'script, iframe, frame, frameset, object, embed, applet, form, base, meta[http-equiv]'
const PAGE_TYPES = new Set(['application/xhtml+xml', 'text/html', 'image/svg+xml'])

export function isPage(type: string): boolean {
  return PAGE_TYPES.has(type)
}

export function inertPage(source: string, type: string): string {
  const doc = new DOMParser().parseFromString(source, type as DOMParserSupportedType)
  for (const element of doc.querySelectorAll(ACTIVE_ELEMENTS)) element.remove()
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
