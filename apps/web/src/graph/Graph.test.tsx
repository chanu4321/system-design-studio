import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DiagramModel } from '@sd/model'
import { Graph } from './Graph.js'

// Graph's own layout/positioning is what's under test here. Mounting a real
// ReactFlow needs DOM measurement (ResizeObserver etc.) jsdom doesn't provide,
// so it's stubbed down to something that just exposes the node positions
// Graph computed for it — the same reasoning TypeNode.test.tsx uses for
// stubbing Handle.
vi.mock('reactflow', () => ({
  default: ({ nodes }: { nodes: { id: string; position: { x: number; y: number } }[] }) => (
    <div>
      {nodes.map((n) => (
        <div key={n.id} data-testid={`pos-${n.id}`}>{`${n.position.x},${n.position.y}`}</div>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
}))

const empty: DiagramModel = { nodes: [], edges: [] }
const twoNodes: DiagramModel = {
  nodes: [
    { id: 'a', name: 'Vehicle', kind: 'class', file: 'src/Vehicle.java', line: 1, endLine: 3, meta: {} },
    { id: 'b', name: 'Car', kind: 'class', file: 'src/Car.java', line: 1, endLine: 3, meta: {} },
  ],
  edges: [{ from: 'b', to: 'a', kind: 'extends' }],
}

describe('Graph', () => {
  it('lays out newly-appearing nodes at distinct positions rather than stacking them at the origin', () => {
    const { rerender } = render(<Graph model={empty} selectedId={null} onSelect={vi.fn()} />)
    rerender(<Graph model={twoNodes} selectedId={null} onSelect={vi.fn()} />)

    const posA = screen.getByTestId('pos-a').textContent
    const posB = screen.getByTestId('pos-b').textContent
    expect(posA).not.toBe(posB)
  })
})
