// foliate-js ships plain ES modules without types; only what Interleaf uses is declared.
declare module 'foliate-js/vendor/zip.js' {
  export interface ZipEntry {
    filename: string
    uncompressedSize: number
    getData<T>(writer: { readonly __writes?: T }): Promise<T>
  }
  export class BlobReader {
    constructor(blob: Blob)
  }
  export class TextWriter {
    readonly __writes?: string
  }
  export class BlobWriter {
    constructor(type?: string)
    readonly __writes?: Blob
  }
  export class ZipReader {
    constructor(reader: BlobReader)
    getEntries(): Promise<ZipEntry[]>
    close(): Promise<void>
  }
  export function configure(options: { useWebWorkers: boolean }): void
}

declare module 'foliate-js/view.js' {}

declare module 'foliate-js/epubcfi.js' {
  export function compare(a: string, b: string): number
}

declare module 'foliate-js/overlayer.js' {
  type Draw = (rects: DOMRectList, options?: Record<string, unknown>) => SVGElement
  export const Overlayer: { highlight: Draw; underline: Draw; outline: Draw }
}
