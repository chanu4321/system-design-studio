import { createRequire } from 'node:module'
import type { WasmPaths } from './tree-sitter.js'

/**
 * Node-only. The browser supplies its own URLs through Vite. Kept in its own
 * module rather than alongside `createParser` so that browser code can import
 * `createParser` from this package without ever pulling in `node:module`: a
 * consuming bundler must resolve every binding a module imports, even ones the
 * consumer doesn't use, so a shared module fails to build for the browser the
 * moment any export in it references a Node builtin — tree-shaking happens too
 * late to save it. Confirmed by trying it (see the graph-panel task report).
 */
export function defaultWasmPaths(): WasmPaths {
  const require = createRequire(import.meta.url)
  return {
    runtime: require.resolve('web-tree-sitter/tree-sitter.wasm'),
    java: require.resolve('tree-sitter-wasms/out/tree-sitter-java.wasm'),
  }
}
