import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useProjectModel } from './useProjectModel.js'

// Route 1: real Node WASM paths, exercising the hook against the real parser.
// defaultWasmPaths is imported from '@sd/parser/default-wasm-paths.js', not the
// package's main barrel ('@sd/parser') — the barrel deliberately does not
// re-export it, so that no browser build path can reach node:module. See
// packages/parser/src/index.ts for why.
vi.mock('./wasm.js', async () => ({
  wasmPaths: (await import('@sd/parser/default-wasm-paths.js')).defaultWasmPaths(),
}))

const files = [
  { path: 'src/Vehicle.java', content: 'class Vehicle {}' },
  { path: 'src/Car.java', content: 'class Car extends Vehicle {}' },
]

describe('useProjectModel', () => {
  it('starts empty and fills in once the parser is ready', async () => {
    const { result } = renderHook(() => useProjectModel(files))
    expect(result.current.model.nodes).toEqual([])
    await waitFor(() => expect(result.current.model.nodes).toHaveLength(2))
  })

  it('reflects an edit without a reload', async () => {
    const { result } = renderHook(() => useProjectModel(files))
    await waitFor(() => expect(result.current.model.nodes).toHaveLength(2))

    act(() => result.current.update('src/Vehicle.java', 'class Vehicle {}\nclass Bike {}'))
    await waitFor(() => expect(result.current.model.nodes).toHaveLength(3))
  })

  it('survives an edit that does not parse', async () => {
    const { result } = renderHook(() => useProjectModel(files))
    await waitFor(() => expect(result.current.model.nodes).toHaveLength(2))

    act(() => result.current.update('src/Vehicle.java', 'class Vehicle { void go( }'))
    await waitFor(() =>
      expect(result.current.model.nodes.find((n) => n.name === 'Vehicle')?.stale).toBe(true),
    )
    expect(result.current.model.nodes).toHaveLength(2)
  })
})
