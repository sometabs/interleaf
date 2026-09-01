import { app, shell, BrowserWindow, net, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import icon from '../../resources/icon.png?asset'
import { initDb, closeDb } from './db/connection'
import { referencedCovers } from './services/backup'
import { resolveUserDataDir } from './db/userdata'
import { registerIpcHandlers } from './ipc/handlers'
import { isAppUrl, isExternalLink } from './navigation'
import { coverForId, coversDir, pruneOrphanCovers, resolveCoverPath } from './services/covers'

// Must run before anything touches disk.
app.setPath('userData', resolveUserDataDir(app.getPath('appData')))

// The only scheme that can reach the UI with an image, and it serves one directory.
protocol.registerSchemesAsPrivileged([
  { scheme: 'bookcover', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function registerCoverProtocol(): void {
  protocol.handle('bookcover', async (request) => {
    const url = new URL(request.url)
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''))

    // bookcover://covers/<file> is a cover stored against a book;
    // bookcover://id/<coverId> is an Open Library cover, fetched on first use.
    const file = url.host === 'id' ? await coverForId(name) : resolveCoverPath(name)
    if (!file) return new Response(null, { status: 404 })

    const response = await net.fetch(pathToFileURL(file).toString())
    // Cached art never changes for a given id.
    response.headers.set('Cache-Control', 'max-age=86400')
    return response
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#16171a',
    // Linux needs this even when packaged; a packaged Windows build uses the
    // .exe's own multi-size .ico instead.
    ...(process.platform === 'linux' || !app.isPackaged ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer is untrusted; all of its capability is in the preload bridge.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Renderer console output, in the terminal.
  if (is.dev) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer] ${event.message}`)
    })
  }

  const rendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const indexHtml = join(__dirname, '../renderer/index.html')
  const appUrl = rendererUrl ?? pathToFileURL(indexHtml).toString()

  // No new windows; web links go to the browser.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isExternalLink(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // No navigation off the app's own document either: the preload, bridge and
  // all, is injected into whatever loads here. See `navigation.ts`.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, appUrl)) return
    event.preventDefault()
    if (isExternalLink(url)) shell.openExternal(url)
  })

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(indexHtml)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.interleaf.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Open before the renderer exists to ask it anything.
  const db = initDb()
  pruneOrphanCovers(coversDir(), referencedCovers(db))
  registerCoverProtocol()
  registerIpcHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', closeDb)
