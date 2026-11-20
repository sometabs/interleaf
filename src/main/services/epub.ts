import { createHash } from 'crypto'
import {
  BlobReader,
  configure,
  TextWriter,
  ZipReader,
  type ZipEntry
} from 'foliate-js/vendor/zip.js'

export interface EpubDetails {
  sha256: string
  title: string | null
  author: string | null
  isbn: string | null
}

export class EpubError extends Error {}

export const NOT_AN_EPUB = 'This file isn’t a readable EPUB.'
export const PROTECTED_EPUB = 'This EPUB is protected and can’t be opened.'

// Each DRM scheme leaves one of these files behind.
const DRM_MARKERS = ['META-INF/rights.xml', 'META-INF/license.lcpl', 'META-INF/sinf.xml']

// Font obfuscation also lists files in encryption.xml, but DRM-free books use it too.
const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC'
])

export async function inspectEpub(bytes: Uint8Array): Promise<EpubDetails> {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const entries = await readEntries(bytes)
  const byName = new Map(entries.map((entry) => [entry.filename, entry]))
  const text = (name: string): Promise<string> | null =>
    byName.get(name)?.getData(new TextWriter()) ?? null

  if (DRM_MARKERS.some((name) => byName.has(name))) throw new EpubError(PROTECTED_EPUB)
  const encryption = await text('META-INF/encryption.xml')
  if (encryption && encryptsContent(encryption)) throw new EpubError(PROTECTED_EPUB)

  const container = await text('META-INF/container.xml')
  const opfPath = container && /full-path\s*=\s*["']([^"']+)["']/i.exec(container)?.[1]
  const opf = opfPath ? await text(decodeURIComponent(opfPath)) : null
  if (!opf) throw new EpubError(NOT_AN_EPUB)

  return {
    sha256,
    title: element(opf, 'title'),
    author: element(opf, 'creator'),
    isbn: isbnOf(opf)
  }
}

async function readEntries(bytes: Uint8Array): Promise<ZipEntry[]> {
  configure({ useWebWorkers: false })
  try {
    const reader = new ZipReader(new BlobReader(new Blob([bytes as Uint8Array<ArrayBuffer>])))
    return await reader.getEntries()
  } catch {
    throw new EpubError(NOT_AN_EPUB)
  }
}

export function encryptsContent(xml: string): boolean {
  const algorithms = [
    ...xml.matchAll(/<(?:\w+:)?EncryptionMethod[^>]*Algorithm\s*=\s*["']([^"']+)["']/gi)
  ]
  return algorithms.some(([, algorithm]) => !FONT_OBFUSCATION.has(algorithm))
}

function element(opf: string, name: string): string | null {
  const match = new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, 'i').exec(opf)
  const value = match
    ? decodeXml(match[1].replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
    : ''
  return value || null
}

function isbnOf(opf: string): string | null {
  for (const [, inner] of opf.matchAll(/<dc:identifier\b[^>]*>([\s\S]*?)<\/dc:identifier>/gi)) {
    const digits = decodeXml(inner)
      .replace(/^urn:isbn:/i, '')
      .replace(/[\s-]/g, '')
    if (/^(97[89]\d{10}|\d{9}[\dX])$/i.test(digits)) return digits.toUpperCase()
  }
  return null
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => codePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d+);/g, (whole, dec: string) => codePoint(Number(dec), whole))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function codePoint(value: number, fallback: string): string {
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : fallback
}
