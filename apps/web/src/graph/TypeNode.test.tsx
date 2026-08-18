import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ModelNode } from '@sd/model'
import { TypeNode } from './TypeNode.js'

// `Handle` reads React Flow's store, which does not exist outside a provider.
// These tests are about this component's own markup, so the handles are stubbed
// rather than dragging a whole flow instance into every render.
vi.mock('reactflow', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

const node: ModelNode = {
  id: 'a',
  name: 'ParkingLot',
  kind: 'class',
  file: 'src/ParkingLot.java',
  line: 1,
  endLine: 20,
  members: {
    fields: [{ name: 'spots', type: 'List<Spot>', visibility: 'private', static: false }],
    methods: [
      { name: 'park', returnType: 'Ticket', params: [{ name: 'v', type: 'Vehicle' }], visibility: 'public', static: false },
    ],
  },
  meta: {},
}

describe('TypeNode', () => {
  it('shows the name and kind when not selected', () => {
    render(<TypeNode data={{ node }} selected={false} />)
    expect(screen.getByText('ParkingLot')).toBeTruthy()
    expect(screen.getByText('class')).toBeTruthy()
  })

  it('hides members when not selected', () => {
    render(<TypeNode data={{ node }} selected={false} />)
    expect(screen.queryByText(/spots/)).toBeNull()
    expect(screen.queryByText(/park/)).toBeNull()
  })

  it('shows fields and methods when selected', () => {
    render(<TypeNode data={{ node }} selected={true} />)
    expect(screen.getByText(/spots: List<Spot>/)).toBeTruthy()
    expect(screen.getByText(/park\(v: Vehicle\): Ticket/)).toBeTruthy()
  })

  it('renders visibility markers', () => {
    render(<TypeNode data={{ node }} selected={true} />)
    expect(screen.getByText(/^- spots/)).toBeTruthy()
    expect(screen.getByText(/^\+ park/)).toBeTruthy()
  })

  it('marks a stale node', () => {
    render(<TypeNode data={{ node: { ...node, stale: true } }} selected={false} />)
    expect(screen.getByTitle(/not parsing/i)).toBeTruthy()
  })

  it('renders an interface without crashing when it has no members', () => {
    render(<TypeNode data={{ node: { id: 'i', name: 'Movable', kind: 'interface', meta: {} } }} selected={true} />)
    expect(screen.getByText('Movable')).toBeTruthy()
  })
})
