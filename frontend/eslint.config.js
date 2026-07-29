import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    // NoteBi does not enable babel-plugin-react-compiler. Keep the two
    // runtime-correctness hook rules strict without applying compiler-only
    // constraints (for example set-state-in-effect) to this non-compiled app.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['error', {
        allowConstantExport: true,
        allowExportNames: [
          'badgeVariants',
          'buttonVariants',
          'slugify',
          'flattenText',
          'extractToc',
          'formatDuration',
          'localFileTypeLabel',
          'itemTypeLabel',
          'normalizePreviewImageUrl',
          'previewImageFallback',
          'libraryItemKey',
          'batchSourceItemKey',
          'computeAutoInterval',
          'estimateFrames',
          'loadPersistedScope',
          'persistScope',
          'scopeSummary',
          'mergeLogEntries',
          'deriveSteps',
          'TS_RE',
          'parseTs',
        ],
      }],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
