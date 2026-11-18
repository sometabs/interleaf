import { BrowserWindow, dialog } from 'electron'

export interface Updater {
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

// Downloads in the background; a declined restart still installs when the app quits.
export function watchForUpdates(
  updater: Updater,
  askToRestart: (version: string) => Promise<boolean>
): void {
  // Offline or GitHub unreachable: stay quiet and try again next start.
  updater.on('error', (error) => console.warn(`[updates] ${error.message}`))
  updater.on('update-downloaded', async ({ version }) => {
    if (await askToRestart(version)) updater.quitAndInstall(true, true)
  })
  updater.checkForUpdates().catch(() => {})
}

const RESTART = 0

export async function askToRestart(version: string): Promise<boolean> {
  const options = {
    type: 'info' as const,
    title: 'Update ready',
    message: `Interleaf ${version} is ready to install.`,
    detail: 'Restart now to update, or it will update the next time you close Interleaf.',
    buttons: ['Restart now', 'Later'],
    defaultId: RESTART,
    cancelId: 1,
    noLink: true
  }
  const window = BrowserWindow.getAllWindows()[0]
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return response === RESTART
}
