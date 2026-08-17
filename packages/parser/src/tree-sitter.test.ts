import { afterEach, describe, expect, it, vi } from 'vitest'
import { createParser, defaultWasmPaths } from './tree-sitter.js'

describe('createParser', () => {
  it('parses a Java class into a tree whose root is a program', async () => {
    const parser = await createParser(defaultWasmPaths())
    const tree = parser.parse('class Vehicle {}')
    expect(tree.rootNode.type).toBe('program')
    expect(tree.rootNode.hasError).toBe(false)
  })

  it('produces a usable tree from broken source rather than throwing', async () => {
    const parser = await createParser(defaultWasmPaths())
    const tree = parser.parse('class Vehicle { void go( }')
    expect(tree.rootNode.type).toBe('program')
    expect(tree.rootNode.hasError).toBe(true)
  })

  it('reuses one initialisation across calls', async () => {
    const a = await createParser(defaultWasmPaths())
    const b = await createParser(defaultWasmPaths())
    expect(a.parse('class A {}').rootNode.type).toBe('program')
    expect(b.parse('class B {}').rootNode.type).toBe('program')
  })
})

// These tests need a module instance whose module-level `initialised`/`languages`
// caches have never been touched by another test in this file, and they need to
// install spies on `web-tree-sitter`'s `Parser.init`/`Parser.Language.load` before
// that fresh instance's first call runs. `vi.resetModules()` plus a dynamic import
// (rather than the static top-level import used above) gets a clean module
// instance per test; importing 'web-tree-sitter' first and spying on it before
// dynamically importing './tree-sitter.js' guarantees the spy is in place before
// createParser ever calls through to it, since both imports resolve to the same
// freshly-cached module record.
describe('createParser caching', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * `web-tree-sitter@0.24.7` only assigns the `Parser.Language` static property
   * from inside `Parser.init()`'s own body (verified by reading the installed
   * package's source: the assignment sits inside `static init()`'s promise
   * executor) — it does not exist right after importing the module. Spying on
   * `Parser.Language.load` before any `init()` call throws
   * "Cannot convert undefined or null to object". Warm-up, unspied, so it
   * exists before we install spies; this call happens before any spy is
   * installed, so it does not count toward the call-count assertions below.
   */
  async function freshWebTreeSitter() {
    const webTreeSitter = await import('web-tree-sitter')
    const Parser = webTreeSitter.default
    await Parser.init()
    return Parser
  }

  it('calls Parser.init and Language.load exactly once across two createParser calls with the same paths', async () => {
    vi.resetModules()
    const Parser = await freshWebTreeSitter()
    const initSpy = vi.spyOn(Parser, 'init')
    const loadSpy = vi.spyOn(Parser.Language, 'load')
    const treeSitter = await import('./tree-sitter.js')
    const paths = treeSitter.defaultWasmPaths()

    await treeSitter.createParser(paths)
    await treeSitter.createParser(paths)

    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(loadSpy).toHaveBeenCalledTimes(1)
  })

  it('retries after a rejected Parser.init instead of caching the failure forever', async () => {
    vi.resetModules()
    const Parser = await freshWebTreeSitter()
    const initSpy = vi.spyOn(Parser, 'init').mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const treeSitter = await import('./tree-sitter.js')
    const paths = treeSitter.defaultWasmPaths()

    await expect(treeSitter.createParser(paths)).rejects.toThrow('boom')
    const parser = await treeSitter.createParser(paths)

    expect(parser.parse('class Retry {}').rootNode.type).toBe('program')
    expect(initSpy).toHaveBeenCalledTimes(2)
  })

  it('retries after a rejected Language.load instead of caching the failure forever', async () => {
    vi.resetModules()
    const Parser = await freshWebTreeSitter()
    const loadSpy = vi.spyOn(Parser.Language, 'load').mockImplementationOnce(() => Promise.reject(new Error('boom')))
    const treeSitter = await import('./tree-sitter.js')
    const paths = treeSitter.defaultWasmPaths()

    await expect(treeSitter.createParser(paths)).rejects.toThrow('boom')
    const parser = await treeSitter.createParser(paths)

    expect(parser.parse('class Retry {}').rootNode.type).toBe('program')
    expect(loadSpy).toHaveBeenCalledTimes(2)
  })
})
