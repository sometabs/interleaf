export interface Updater {
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

let ready: { version: string; install: () => void } | null = null

// Downloads in the background; an update nobody restarts for installs when the app quits.
export function watchForUpdates(updater: Updater, announce: (version: string) => void): void {
  ready = null
  // Offline or GitHub unreachable: stay quiet and try again next start.
  updater.on('error', (error) => console.warn(`[updates] ${error.message}`))
  updater.on('update-downloaded', ({ version }) => {
    ready = { version, install: () => updater.quitAndInstall(true, true) }
    announce(version)
  })
  updater.checkForUpdates().catch(() => {})
}

export function readyUpdate(): string | null {
  return ready?.version ?? null
}

export function installReadyUpdate(): void {
  ready?.install()
}
