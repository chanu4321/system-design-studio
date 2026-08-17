import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'

export type WasmPaths = { runtime: string; java: string }

export type JavaParser = {
  parse(source: string): Parser.Tree
}

let initialised: Promise<void> | null = null
const languages = new Map<string, Promise<Parser.Language>>()

/**
 * WASM paths are injected rather than resolved internally so this package works
 * unchanged in Node (filesystem paths, for tests) and in the browser (asset URLs
 * that Vite fingerprints). Resolving them here would tie the parser to one host.
 */
export async function createParser(wasm: WasmPaths): Promise<JavaParser> {
  initialised ??= Parser.init({ locateFile: () => wasm.runtime })
  await initialised

  let javaLanguage = languages.get(wasm.java)
  if (!javaLanguage) {
    javaLanguage = Parser.Language.load(wasm.java)
    languages.set(wasm.java, javaLanguage)
  }

  const parser = new Parser()
  parser.setLanguage(await javaLanguage)

  return {
    parse: (source: string) => parser.parse(source),
  }
}

/** Node-only. The browser supplies its own URLs through Vite. */
export function defaultWasmPaths(): WasmPaths {
  const require = createRequire(import.meta.url)
  return {
    runtime: require.resolve('web-tree-sitter/tree-sitter.wasm'),
    java: require.resolve('tree-sitter-wasms/out/tree-sitter-java.wasm'),
  }
}
