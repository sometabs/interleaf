import { tmpdir } from 'node:os'

// The main process reaches `electron` through covers.ts. Loading the real
// package spawns a 100 MB binary download, which times tests out on CI.
export const app = {
  getPath: (): string => tmpdir()
}
