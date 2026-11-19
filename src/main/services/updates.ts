import type { ReadyUpdate, ReleaseNoteLine } from '../../shared/api'

interface DownloadedUpdate {
  version: string
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null
}

export interface Updater {
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'update-downloaded', listener: (info: DownloadedUpdate) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

let ready: { update: ReadyUpdate; install: () => void } | null = null

// Downloads in the background; an update nobody restarts for installs when the app quits.
export function watchForUpdates(updater: Updater, announce: (update: ReadyUpdate) => void): void {
  ready = null
  // Offline or GitHub unreachable: stay quiet and try again next start.
  updater.on('error', (error) => console.warn(`[updates] ${error.message}`))
  updater.on('update-downloaded', (info) => {
    const update = { version: info.version, notes: releaseNoteLines(notesFor(info)) }
    ready = { update, install: () => updater.quitAndInstall(true, true) }
    announce(update)
  })
  updater.checkForUpdates().catch(() => {})
}

export function readyUpdate(): ReadyUpdate | null {
  return ready?.update ?? null
}

export function installReadyUpdate(): void {
  ready?.install()
}

function notesFor({ version, releaseNotes }: DownloadedUpdate): string {
  if (!releaseNotes) return ''
  if (typeof releaseNotes === 'string') return releaseNotes
  const entry = releaseNotes.find((release) => release.version === version) ?? releaseNotes[0]
  return entry?.note ?? ''
}

const BLOCK = /<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi

// GitHub sends the notes as HTML; only their text reaches the window.
export function releaseNoteLines(html: string): ReleaseNoteLine[] {
  const lines: ReleaseNoteLine[] = []
  for (const [, tag, inner] of html.matchAll(BLOCK)) {
    const text = plainText(inner)
    if (text) lines.push({ heading: tag[0].toLowerCase() === 'h', text })
  }
  if (lines.length > 0) return lines
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n')
    .map(plainText)
    .filter(Boolean)
    .map((text) => ({ heading: false, text }))
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole
      const point =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
    })
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}
