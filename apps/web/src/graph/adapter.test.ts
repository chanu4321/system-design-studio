import { describe, expect, it } from 'vitest'
import type { DiagramModel } from '@sd/model'
import { EDGE_STYLE, layout, toFlow } from './adapter.js'

const model: DiagramModel = {
  nodes: [
    { id: 'a', name: 'Vehicle', kind: 'class', file: 'src/Vehicle.java', line: 1, endLine: 3, meta: {} },
    { id: 'b', name: 'Car', kind: 'class', file: 'src/Car.java', line: 1, endLine: 3, meta: {} },
  ],
  edges: [{ from: 'b', to: 'a', kind: 'extends' }],
}

describe('layout', () => {
  it('gives every node a position', () => {
    const positions = layout(model)
    expect(positions.get('a')).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
    expect(positions.get('b')).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  })

  it('places a subclass below its superclass', () => {
    const positions = layout(model)
    expect((positions.get('b')?.y ?? 0)).toBeGreaterThan(positions.get('a')?.y ?? 0)
  })

  it('handles a model with no edges', () => {
    expect(layout({ nodes: model.nodes, edges: [] }).size).toBe(2)
  })

  it('handles an empty model', () => {
    expect(layout({ nodes: [], edges: [] }).size).toBe(0)
  })
})

describe('toFlow', () => {
  it('carries the model node through as flow data', () => {
    const { nodes } = toFlow(model, layout(model))
    expect(nodes[0]).toMatchObject({ id: 'a', type: 'type', data: { node: model.nodes[0] } })
  })

  it('uses the supplied position rather than inventing one', () => {
    const { nodes } = toFlow(model, new Map([['a', { x: 10, y: 20 }], ['b', { x: 0, y: 0 }]]))
    expect(nodes.find((n) => n.id === 'a')?.position).toEqual({ x: 10, y: 20 })
  })

  it('translates edges with a stable id and a kind-specific style', () => {
    const { edges } = toFlow(model, layout(model))
    expect(edges).toHaveLength(1)
    expect(edges[0]?.id).toBe('b->a:extends')
    expect(edges[0]?.style?.stroke).toBe(EDGE_STYLE.extends.stroke)
  })

  it('marks a stale node so the renderer can show it', () => {
    const stale: DiagramModel = {
      nodes: [{ ...model.nodes[0]!, stale: true }],
      edges: [],
    }
    const { nodes } = toFlow(stale, layout(stale))
    expect(nodes[0]?.data.node.stale).toBe(true)
  })
})
