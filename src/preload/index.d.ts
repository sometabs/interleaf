import type { InterleafBridge } from '../shared/api'

declare global {
  interface Window {
    interleaf: InterleafBridge
  }
}

export {}
