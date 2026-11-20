import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

// The reader opens EPUB only; foliate's other formats (PDF, MOBI, comics, FB2) stay out of the app.
const UNUSED_FOLIATE_FORMATS = [
  './pdf.js',
  './mobi.js',
  './comic-book.js',
  './fb2.js',
  './vendor/fflate.js'
]
const STUB = '\0foliate-unused-format'
function epubOnly(): Plugin {
  return {
    name: 'interleaf-epub-only',
    enforce: 'pre',
    resolveId(source, importer) {
      const fromFoliate = importer?.split('\\').join('/').includes('/foliate-js/')
      return fromFoliate && UNUSED_FOLIATE_FORMATS.includes(source) ? STUB : null
    },
    load(id) {
      return id === STUB ? 'export {}' : null
    },
    // foliate allows scripts in book frames only to work around a WebKit bug; Chromium does not need it.
    transform(code, id) {
      // Dev ids carry a query such as `?v=1a2b`.
      const path = id.split('?')[0].split('\\').join('/')
      if (!/\/foliate-js\/(paginator|fixed-layout)\.js$/.test(path)) return null
      const sandbox = "'allow-same-origin allow-scripts'"
      if (!code.includes(sandbox)) {
        throw new Error(
          `foliate-js changed how ${path} sandboxes book frames; review before building.`
        )
      }
      return code.split(sandbox).join("'allow-same-origin'")
    }
  }
}

export default defineConfig({
  main: {
    // better-sqlite3 is native: it must be required at runtime, not bundled.
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    plugins: [epubOnly(), react(), tailwindcss()],
    // Pre-bundling would skip epubOnly in dev, leaving scripts allowed in book frames.
    optimizeDeps: { exclude: ['foliate-js'] },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  }
})
