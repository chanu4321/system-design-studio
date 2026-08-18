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
  // Do NOT add optimizeDeps.exclude for 'web-tree-sitter'. It was there
  // (harmlessly, until this task actually mounted the graph in a live page)
  // and broke `pnpm dev` outright: web-tree-sitter is a plain CommonJS module
  // (`module.exports = TreeSitter`, no `exports` map), and excluding it from
  // the dep optimizer means Vite serves the raw file to the browser instead
  // of esbuild's pre-bundled ESM-interop version — the browser then throws
  // "does not provide an export named 'default'" on `import Parser from
  // 'web-tree-sitter'`, and the whole app fails to render (App.tsx imports
  // Workspace eagerly, which imports this transitively). Confirmed by
  // reproducing and reverting during Task 14's manual walkthrough. The
  // production build (`vite build`) was never affected — Rollup's CJS
  // interop runs regardless of this dev-only setting.
  test: { environment: 'jsdom', globals: true, restoreMocks: true },
})
