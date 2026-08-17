import runtimeUrl from 'web-tree-sitter/tree-sitter.wasm?url'
import javaUrl from 'tree-sitter-wasms/out/tree-sitter-java.wasm?url'

/** Vite fingerprints and serves these; the parser package stays host-agnostic. */
export const wasmPaths = { runtime: runtimeUrl, java: javaUrl }
