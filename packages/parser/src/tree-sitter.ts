import Parser from 'web-tree-sitter'

export type WasmPaths = { runtime: string; java: string }

export type JavaParser = {
  parse(source: string): Parser.Tree
}

// tree-sitter-wasms@0.1.13 (the exact version pinned in package.json) built
// out/tree-sitter-java.wasm from tree-sitter-java ^0.20.2 via tree-sitter-cli
// ^0.20.8 — read directly from that package's own package.json
// devDependencies, not from its (nonexistent) release notes. That is an old
// grammar vintage (circa 2023): node-type names used by later tasks (type
// extraction, reference extraction) must be checked against this grammar,
// not assumed from the latest tree-sitter-java spec. Bumping
// tree-sitter-wasms past 0.1.13 can silently change the grammar this comment
// describes — it is exact-pinned in package.json for that reason.
let initialised: Promise<void> | null = null
const languages = new Map<string, Promise<Parser.Language>>()

/**
 * WASM paths are injected rather than resolved internally so this package works
 * unchanged in Node (filesystem paths, for tests) and in the browser (asset URLs
 * that Vite fingerprints). Resolving them here would tie the parser to one host.
 */
export async function createParser(wasm: WasmPaths): Promise<JavaParser> {
  // A rejected init/load must not be cached forever: a transient WASM-fetch
  // failure in the browser would otherwise permanently break the parser for
  // the rest of the session. On rejection, clear the module-level slot so the
  // next call retries, while this call's own awaiters still see the original
  // error.
  initialised ??= Parser.init({ locateFile: () => wasm.runtime }).catch((err: unknown) => {
    initialised = null
    throw err
  })
  await initialised

  let javaLanguage = languages.get(wasm.java)
  if (!javaLanguage) {
    javaLanguage = Parser.Language.load(wasm.java).catch((err: unknown) => {
      languages.delete(wasm.java)
      throw err
    })
    languages.set(wasm.java, javaLanguage)
  }

  const parser = new Parser()
  parser.setLanguage(await javaLanguage)

  return {
    parse: (source: string) => parser.parse(source),
  }
}
