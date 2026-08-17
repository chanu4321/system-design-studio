import { describe, expect, it } from 'vitest'
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
