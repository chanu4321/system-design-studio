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

  // The real consumer (Workspace) mounts this hook with files: [] and populates
  // it from an async effect once its own load request resolves — so a change
  // to `files` can land either before or after parser initialisation finishes.
  // Both orderings must seed correctly, not just the "files present at mount"
  // shape the tests above exercise.

  it('seeds with files that arrive before parser initialisation finishes', async () => {
    const { result, rerender } = renderHook(
      ({ files: f }) => useProjectModel(f),
      { initialProps: { files: [] as { path: string; content: string }[] } },
    )
    // Synchronous — no await has happened yet, so createParser()'s promise is
    // still pending when this lands, exactly like Workspace's real timing.
    rerender({ files })
    await waitFor(() => expect(result.current.model.nodes).toHaveLength(2))
  })

  it('re-seeds when the file set changes after parser initialisation has already finished', async () => {
    const { result, rerender } = renderHook(
      ({ files: f }) => useProjectModel(f),
      { initialProps: { files } },
    )
    // Confirms init has genuinely completed (an empty model here would be
    // ambiguous with "hasn't started yet"; a 2-node model is not).
    await waitFor(() => expect(result.current.model.nodes).toHaveLength(2))

    const withBike = [...files, { path: 'src/Bike.java', content: 'class Bike {}' }]
    rerender({ files: withBike })
    await waitFor(() => expect(result.current.model.nodes).toHaveLength(3))
  })

  // Isolated: forces a fresh createParser/createProjectModel call chain with a
  // deliberately invalid Java grammar path (the runtime path stays valid and
  // reuses whatever is already cached) so Parser.Language.load genuinely
  // rejects, the same way a 404'd WASM asset would in production. resetModules
  // gives a clean @sd/parser module instance (its own init/language caches are
  // module-level state, same mechanism packages/parser's own caching tests
  // rely on) and doMock overrides just this dynamic import's wasm paths without
  // disturbing the file-level mock the tests above use.
  it('surfaces a rejected parser initialisation instead of an unhandled rejection', async () => {
    vi.resetModules()
    vi.doMock('./wasm.js', async () => ({
      wasmPaths: {
        runtime: (await import('@sd/parser/default-wasm-paths.js')).defaultWasmPaths().runtime,
        java: 'this-grammar-file-does-not-exist.wasm',
      },
    }))
    const { useProjectModel: freshUseProjectModel } = await import('./useProjectModel.js')

    const { result } = renderHook(() => freshUseProjectModel(files))

    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.model.nodes).toEqual([])
  })
})
