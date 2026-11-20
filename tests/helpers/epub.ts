import { crc32 } from 'node:zlib'

export interface EpubFixture {
  title?: string
  author?: string
  isbn?: string
  chapters?: string[]
  // Extra files placed in the zip as-is, e.g. DRM markers.
  extra?: Record<string, string>
  mimetype?: string
}

// Stored (uncompressed) entries are a valid zip and need no deflate.
export function zipStored(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = typeof content === 'string' ? encoder.encode(content) : content
    const crc = crc32(data)

    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)

    locals.push(local)
    centrals.push(central)
    offset += local.length
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function makeEpub({
  title = 'The Glass Orchard',
  author = 'Mira Halden',
  isbn,
  chapters = ['<p>The orchard was made of glass.</p>'],
  extra = {},
  mimetype = 'application/epub+zip'
}: EpubFixture = {}): Uint8Array {
  const manifest = chapters
    .map(
      (_, index) =>
        `<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`
    )
    .join('')
  const spine = chapters.map((_, index) => `<itemref idref="c${index}"/>`).join('')
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">${isbn ? `urn:isbn:${isbn}` : 'urn:uuid:00000000-0000-4000-8000-000000000000'}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`
  const files: Record<string, string> = {
    mimetype,
    'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${chapters
      .map((_, index) => `<li><a href="c${index}.xhtml">Chapter ${index + 1}</a></li>`)
      .join('')}</ol></nav></body></html>`,
    ...extra
  }
  chapters.forEach((body, index) => {
    files[`OEBPS/c${index}.xhtml`] =
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${index + 1}</title></head><body>${body}</body></html>`
  })
  return zipStored(files)
}
