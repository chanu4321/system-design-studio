import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { DiagramModel } from '@sd/model'
import { Graph } from './Graph.js'

// Spies standing in for the real hooks Graph.tsx's FitOnTypeSetChange calls:
// useReactFlow().fitView and useUpdateNodeInternals(). vi.hoisted so the mock
// factory (hoisted above this file's imports) and the tests below share the
// same functions. fitView resolves "true" (fitted) on its very first call —
// FitOnTypeSetChange retries on requestAnimationFrame until fitView()
// reports success, and a mock that always succeeds immediately keeps that
// retry loop out of the test's critical path entirely.
const { fitView, updateNodeInternals } = vi.hoisted(() => ({
  fitView: vi.fn(() => true),
  updateNodeInternals: vi.fn(),
}))

// Graph's own layout/positioning is what's under test here. Mounting a real
// ReactFlow needs DOM measurement (ResizeObserver etc.) jsdom doesn't
// provide, so it's stubbed down to something that just exposes the node
// positions Graph computed for it — the same reasoning TypeNode.test.tsx
// uses for stubbing Handle — while still rendering `children` so
// FitOnTypeSetChange (passed as a child of <ReactFlow>, exactly like the
// real component) actually mounts and its hooks fire.
vi.mock('reactflow', () => ({
  default: ({
    nodes,
    children,
  }: {
    nodes: { id: string; position: { x: number; y: number } }[]
    children?: ReactNode
  }) => (
    <div>
      {nodes.map((n) => (
        <div key={n.id} data-testid={`pos-${n.id}`}>{`${n.position.x},${n.position.y}`}</div>
      ))}
      {children}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  useReactFlow: () => ({ fitView }),
  useUpdateNodeInternals: () => updateNodeInternals,
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
  beforeEach(() => {
    fitView.mockClear()
    updateNodeInternals.mockClear()
  })

  it('lays out newly-appearing nodes at distinct positions rather than stacking them at the origin', () => {
    const { rerender } = render(<Graph model={empty} selectedId={null} onSelect={vi.fn()} />)
    rerender(<Graph model={twoNodes} selectedId={null} onSelect={vi.fn()} />)

    const posA = screen.getByTestId('pos-a').textContent
    const posB = screen.getByTestId('pos-b').textContent
    expect(posA).not.toBe(posB)
  })

  it('re-fits the view when the type set changes, but not on a content-only edit', () => {
    const { rerender } = render(<Graph model={empty} selectedId={null} onSelect={vi.fn()} />)
    fitView.mockClear() // discard whatever the initial (empty-model) mount triggered

    // empty -> twoNodes is a type-set change: the same signal that already
    // gates the layout recompute.
    rerender(<Graph model={twoNodes} selectedId={null} onSelect={vi.fn()} />)
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(updateNodeInternals).toHaveBeenCalledWith(['a', 'b'])

    fitView.mockClear()
    updateNodeInternals.mockClear()

    // Same two node ids, different member data — a content-only edit (the
    // shape a keystroke inside a method body produces), not a type-set
    // change. A user who has deliberately panned or zoomed while editing
    // must not have the view yanked back out from under them.
    const contentOnlyEdit: DiagramModel = {
      ...twoNodes,
      nodes: twoNodes.nodes.map((n) =>
        n.id === 'b' ? { ...n, members: { fields: [], methods: [] } } : n,
      ),
    }
    rerender(<Graph model={contentOnlyEdit} selectedId={null} onSelect={vi.fn()} />)
    expect(fitView).not.toHaveBeenCalled()
    expect(updateNodeInternals).not.toHaveBeenCalled()
  })
})
