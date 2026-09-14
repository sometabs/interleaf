import { contextBridge, ipcRenderer } from 'electron'

import {
  HARVEST_PROGRESS_CHANNEL,
  type InterleafApi,
  type InterleafBridge,
  type HarvestProgress,
  METADATA_REFRESH_PROGRESS_CHANNEL,
  type MetadataRefreshProgress,
  SEMANTIC_PROGRESS_CHANNEL,
  type SemanticProgress,
  IPC_CHANNELS
} from '../shared/api'

// The context bridge rejects a Proxy or class instance with "An object could
// not be cloned", naming neither the value nor the channel.
function toPlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

// Runs under `sandbox: true`, so it may only import from 'electron'.
const api = Object.fromEntries(
  IPC_CHANNELS.map((channel) => [
    channel,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args.map(toPlain))
  ])
) as unknown as InterleafApi

/** Wrapped, because the raw handler receives an event carrying `sender`. */
const bridge: InterleafBridge = {
  ...api,
  onHarvestProgress(listener: (progress: HarvestProgress) => void) {
    const wrapped = (_event: unknown, progress: HarvestProgress): void => listener(progress)
    ipcRenderer.on(HARVEST_PROGRESS_CHANNEL, wrapped)
    return () => {
      ipcRenderer.off(HARVEST_PROGRESS_CHANNEL, wrapped)
    }
  },
  onMetadataRefreshProgress(listener: (progress: MetadataRefreshProgress) => void) {
    const wrapped = (_event: unknown, progress: MetadataRefreshProgress): void => listener(progress)
    ipcRenderer.on(METADATA_REFRESH_PROGRESS_CHANNEL, wrapped)
    return () => {
      ipcRenderer.off(METADATA_REFRESH_PROGRESS_CHANNEL, wrapped)
    }
  },
  onSemanticProgress(listener: (progress: SemanticProgress) => void) {
    const wrapped = (_event: unknown, progress: SemanticProgress): void => listener(progress)
    ipcRenderer.on(SEMANTIC_PROGRESS_CHANNEL, wrapped)
    return () => {
      ipcRenderer.off(SEMANTIC_PROGRESS_CHANNEL, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('interleaf', bridge)
