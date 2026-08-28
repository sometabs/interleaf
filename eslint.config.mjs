import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import tseslint from '@electron-toolkit/eslint-config-ts'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']]
  },
  {
    // Importing `confirm` from lib/confirm shadows the global, so this fires
    // only when the import was forgotten.
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: "Use `confirm` from '../lib/confirm', the styled dialog." },
        { name: 'alert', message: 'Use `notify` or `fail` from lib/feedback.' }
      ]
    }
  },
  eslintConfigPrettier
)
