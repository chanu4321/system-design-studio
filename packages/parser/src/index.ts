export { createParser, type JavaParser, type WasmPaths } from './tree-sitter.js'
export { createProjectModel, type ProjectModel } from './project-model.js'

// defaultWasmPaths is deliberately NOT re-exported from here. A bundler must
// resolve every binding a re-exporting module names, even ones a given
// consumer doesn't use — so as long as this barrel names defaultWasmPaths,
// any browser build that imports anything at all from '@sd/parser' pulls in
// default-wasm-paths.ts's node:module import and fails to link, regardless of
// tree-shaking. Confirmed empirically: adding it back here reproduces the
// build failure even when the importer only uses createParser. Node-only
// callers import it directly from '@sd/parser/default-wasm-paths.js'.
