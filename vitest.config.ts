import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  electron: resolve(__dirname, 'tests/stubs/electron.ts')
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.ui.test.tsx']
        }
      },
      {
        plugins: [react()],
        resolve: { alias, conditions: ['browser'] },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/**/*.ui.test.tsx'],
          setupFiles: ['tests/setup.ui.ts']
        }
      }
    ]
  }
})
