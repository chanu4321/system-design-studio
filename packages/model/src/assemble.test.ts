import { describe, expect, it } from 'vitest'
import { assemble, nodeSetChanged } from './assemble.js'
import type { FileModel } from './types.js'

const file = (over: Partial<FileModel> & { file: string }): FileModel => ({
  nodes: [],
  refs: [],
  ...over,
})

const type = (name: string, file: string) => ({
  id: `${file}#${name}`,
  name,
  kind: 'class' as const,
  file,
  line: 1,
  endLine: 5,
  meta: {},
})

describe('assemble', () => {
  it('resolves a reference between two files', () => {
    const model = assemble([
      file({ file: 'A.java', nodes: [type('A', 'A.java')], refs: [{ fromId: 'A.java#A', toName: 'B', kind: 'composition' }] }),
      file({ file: 'B.java', nodes: [type('B', 'B.java')] }),
    ])
    expect(model.edges).toEqual([{ from: 'A.java#A', to: 'B.java#B', kind: 'composition' }])
  })

  it('drops a reference to a type not defined in the project', () => {
    const model = assemble([
      file({ file: 'A.java', nodes: [type('A', 'A.java')], refs: [{ fromId: 'A.java#A', toName: 'String', kind: 'dependency' }] }),
    ])
    expect(model.edges).toEqual([])
  })

  it('draws no edge when two project types share a simple name', () => {
    const model = assemble([
      file({ file: 'A.java', nodes: [type('A', 'A.java')], refs: [{ fromId: 'A.java#A', toName: 'Dup', kind: 'dependency' }] }),
      file({ file: 'x/Dup.java', nodes: [type('Dup', 'x/Dup.java')] }),
      file({ file: 'y/Dup.java', nodes: [type('Dup', 'y/Dup.java')] }),
    ])
    expect(model.edges).toEqual([])
  })

  it('resolves an ambiguous name when one candidate shares the referrer package', () => {
    const model = assemble([
      file({
        file: 'x/A.java',
        package: 'x',
        nodes: [type('A', 'x/A.java')],
        refs: [{ fromId: 'x/A.java#A', toName: 'Dup', kind: 'dependency' }],
      }),
      file({ file: 'x/Dup.java', package: 'x', nodes: [type('Dup', 'x/Dup.java')] }),
      file({ file: 'y/Dup.java', package: 'y', nodes: [type('Dup', 'y/Dup.java')] }),
    ])
    expect(model.edges).toEqual([
      { from: 'x/A.java#A', to: 'x/Dup.java#Dup', kind: 'dependency' },
    ])
  })

  it('never draws a self-edge', () => {
    const model = assemble([
      file({ file: 'A.java', nodes: [type('A', 'A.java')], refs: [{ fromId: 'A.java#A', toName: 'A', kind: 'dependency' }] }),
    ])
    expect(model.edges).toEqual([])
  })

  it('deduplicates identical edges', () => {
    const model = assemble([
      file({
        file: 'A.java',
        nodes: [type('A', 'A.java')],
        refs: [
          { fromId: 'A.java#A', toName: 'B', kind: 'dependency' },
          { fromId: 'A.java#A', toName: 'B', kind: 'dependency' },
        ],
      }),
      file({ file: 'B.java', nodes: [type('B', 'B.java')] }),
    ])
    expect(model.edges).toHaveLength(1)
  })

  it('keeps the stronger edge when a pair has both composition and dependency', () => {
    const model = assemble([
      file({
        file: 'A.java',
        nodes: [type('A', 'A.java')],
        refs: [
          { fromId: 'A.java#A', toName: 'B', kind: 'dependency' },
          { fromId: 'A.java#A', toName: 'B', kind: 'composition' },
        ],
      }),
      file({ file: 'B.java', nodes: [type('B', 'B.java')] }),
    ])
    expect(model.edges).toEqual([{ from: 'A.java#A', to: 'B.java#B', kind: 'composition' }])
  })

  it('marks every node from a stale file', () => {
    const model = assemble([
      file({ file: 'A.java', nodes: [type('A', 'A.java')], stale: true }),
    ])
    expect(model.nodes[0]?.stale).toBe(true)
  })

  it('orders nodes deterministically regardless of input order', () => {
    const a = file({ file: 'A.java', nodes: [type('A', 'A.java')] })
    const b = file({ file: 'B.java', nodes: [type('B', 'B.java')] })
    expect(assemble([a, b]).nodes.map((n) => n.id)).toEqual(assemble([b, a]).nodes.map((n) => n.id))
  })
})

describe('nodeSetChanged', () => {
  const model = (ids: string[]) => ({
    nodes: ids.map((id) => ({ id, name: id, kind: 'class' as const, meta: {} })),
    edges: [],
  })

  it('is false when the same ids are present', () => {
    expect(nodeSetChanged(model(['a', 'b']), model(['b', 'a']))).toBe(false)
  })

  it('is true when an id is added', () => {
    expect(nodeSetChanged(model(['a']), model(['a', 'b']))).toBe(true)
  })

  it('is true when an id is removed', () => {
    expect(nodeSetChanged(model(['a', 'b']), model(['a']))).toBe(true)
  })
})
