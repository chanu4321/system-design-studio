import react from '@vitejs/plugin-react'
// Imported from 'vitest/config', not 'vite' — the plain Vite defineConfig has
// no `test` key and would fail typecheck.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:5174' },
  },
  // web-tree-sitter fetches these at runtime rather than importing them, so they
  // must be real served assets, not bundled modules.
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: { exclude: ['web-tree-sitter'] },
  test: { environment: 'jsdom', globals: true, restoreMocks: true },
})
