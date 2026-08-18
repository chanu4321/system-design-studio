import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../api/client.js'
import { Workspace } from './Workspace.js'

// Route 1: real Node WASM paths, exercising the wiring against the real parser
// — the same route Task 13 used for useProjectModel.test.ts. defaultWasmPaths
// comes from '@sd/parser/default-wasm-paths.js', not the package's main
// barrel ('@sd/parser'): the barrel deliberately does not re-export it, so
// that no browser build path can reach node:module. See
// packages/parser/src/index.ts for why.
vi.mock('../graph/wasm.js', async () => ({
  wasmPaths: (await import('@sd/parser/default-wasm-paths.js')).defaultWasmPaths(),
}))

vi.mock('../graph/Graph.js', () => ({
  Graph: ({
    model,
    selectedId,
    onSelect,
  }: {
    model: { nodes: { id: string; name: string }[] }
    selectedId: string | null
    onSelect: (id: string) => void
  }) => (
    <div data-testid="graph">
      <span data-testid="selected">{selectedId ?? ''}</span>
      {model.nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => onSelect(n.id)}>
          node:{n.name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@monaco-editor/react', async () => {
  const { useEffect } = await import('react')
  return {
    default: ({
      value,
      onChange,
      onMount,
    }: {
      value: string
      onChange: (v: string | undefined) => void
      onMount?: (editor: unknown) => void
    }) => {
      useEffect(() => {
        onMount?.({
          onDidChangeCursorPosition: (cb: (e: { position: { lineNumber: number } }) => void) =>
            cb({ position: { lineNumber: 1 } }),
        })
        // Mount-only, matching the real editor's lifecycle.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />
    },
  }
})

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

let client: ApiClient
beforeEach(() => {
  client = {
    listFiles: vi.fn().mockResolvedValue({ files: [{ path: 'src/Vehicle.java', size: 20 }] }),
    readFile: vi
      .fn()
      .mockResolvedValue({ path: 'src/Vehicle.java', content: 'class Vehicle {}', mtimeMs: 1 }),
    readViewContents: vi.fn().mockResolvedValue({
      files: [{ path: 'src/Vehicle.java', content: 'class Vehicle {}', mtimeMs: 1 }],
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn(),
    createProject: vi.fn(),
  } as unknown as ApiClient
})

describe('Workspace', () => {
  it('lists the view files on mount', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    expect(await screen.findByText('src/Vehicle.java')).toBeTruthy()
  })

  it('loads file content into the editor when a file is selected', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await waitFor(() =>
      expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('class Vehicle {}'),
    )
  })

  it('marks the buffer dirty on edit and clean after save', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')

    await userEvent.type(screen.getByLabelText('editor'), ' ')
    expect(await screen.findByText(/unsaved/i)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(client.writeFile).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/unsaved/i)).toBeNull())
  })

  it('does not call writeFile when nothing changed', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(client.writeFile).not.toHaveBeenCalled()
  })

  it('reports a save failure instead of silently discarding the edit', async () => {
    ;(client.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'))
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/unsaved/i)).toBeTruthy()
  })

  it('returns to the library when back is clicked', async () => {
    const onBack = vi.fn()
    render(<Workspace client={client} projectId={ID} view="lld" onBack={onBack} />)
    await userEvent.click(await screen.findByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('prompts before discarding unsaved changes when switching files', async () => {
    ;(client.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [
        { path: 'src/Vehicle.java', size: 20 },
        { path: 'src/Ticket.java', size: 10 },
      ],
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')

    await userEvent.click(screen.getByText('src/Ticket.java'))

    expect(confirm).toHaveBeenCalled()
    // Declined: the dirty buffer is still the one on screen.
    expect(await screen.findByText(/unsaved/i)).toBeTruthy()
  })

  it('does not prompt when switching files with no unsaved changes', async () => {
    ;(client.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [
        { path: 'src/Vehicle.java', size: 20 },
        { path: 'src/Ticket.java', size: 10 },
      ],
    })
    const confirm = vi.spyOn(window, 'confirm')

    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.click(screen.getByText('src/Ticket.java'))

    expect(confirm).not.toHaveBeenCalled()
  })

  it('prompts before leaving with unsaved changes and stays when declined', async () => {
    const onBack = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<Workspace client={client} projectId={ID} view="lld" onBack={onBack} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')

    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(confirm).toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('shows a conflict banner when the save is refused as stale', async () => {
    ;(client.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('File changed on disk'), { status: 409 }),
    )
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/changed on disk/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /overwrite anyway/i })).toBeTruthy()
    // The buffer must stay dirty until the user chooses.
    expect(screen.getByText(/unsaved/i)).toBeTruthy()
  })

  it('reload discards the buffer and takes the version from disk', async () => {
    ;(client.writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('File changed on disk'), { status: 409 }),
    )
    ;(client.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'src/Vehicle.java',
      content: 'from disk',
      mtimeMs: 999,
    })
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByText(/changed on disk/i)

    await userEvent.click(screen.getByRole('button', { name: /reload/i }))

    await waitFor(() =>
      expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('from disk'),
    )
    expect(screen.queryByText(/unsaved/i)).toBeNull()
  })

  it('overwrite anyway retries the save without a precondition', async () => {
    const writeFile = client.writeFile as ReturnType<typeof vi.fn>
    writeFile.mockRejectedValueOnce(
      Object.assign(new Error('File changed on disk'), { status: 409 }),
    )
    writeFile.mockResolvedValueOnce(undefined)

    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByText(/changed on disk/i)

    await userEvent.click(screen.getByRole('button', { name: /overwrite anyway/i }))

    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(2))
    expect(writeFile.mock.calls[1]?.[4]).toBeUndefined() // no precondition on the retry
    await waitFor(() => expect(screen.queryByText(/unsaved/i)).toBeNull())
  })

  it('does not misreport a save as failed when the post-save mtime refresh fails', async () => {
    const readFile = client.readFile as ReturnType<typeof vi.fn>
    readFile.mockResolvedValueOnce({ path: 'src/Vehicle.java', content: 'class Vehicle {}', mtimeMs: 1 })
    readFile.mockRejectedValueOnce(new Error('network down'))

    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(client.writeFile).toHaveBeenCalled())
    // The write succeeded — the buffer must read as clean and nothing must claim it failed.
    await waitFor(() => expect(screen.queryByText(/unsaved/i)).toBeNull())
    expect(screen.queryByText(/save failed/i)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces an error when reload itself fails, instead of leaving a silent banner', async () => {
    ;(client.writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('File changed on disk'), { status: 409 }),
    )
    const readFile = client.readFile as ReturnType<typeof vi.fn>
    readFile.mockResolvedValueOnce({ path: 'src/Vehicle.java', content: 'class Vehicle {}', mtimeMs: 1 })
    readFile.mockRejectedValueOnce(new Error('disk unavailable'))

    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByText(/changed on disk/i)

    await userEvent.click(screen.getByRole('button', { name: /reload/i }))

    expect(await screen.findByText(/disk unavailable/i)).toBeTruthy()
    // Exactly one alert region — a failed reload must not leave the stale
    // conflict banner rendered alongside the new error.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('keeps error and conflict mutually exclusive across repeated failed saves', async () => {
    const writeFile = client.writeFile as ReturnType<typeof vi.fn>
    writeFile.mockRejectedValueOnce(new Error('disk full'))
    writeFile.mockRejectedValueOnce(
      Object.assign(new Error('File changed on disk'), { status: 409 }),
    )

    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByRole('alert') // the non-409 error

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByText(/changed on disk/i)

    // getByRole throws if more than one match — this proves the old error
    // alert was cleared when the conflict banner took over.
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('open() clears the conflict banner when the discarding read itself fails', async () => {
    ;(client.listFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      files: [
        { path: 'src/Vehicle.java', size: 20 },
        { path: 'src/Ticket.java', size: 10 },
      ],
    })
    const readFile = client.readFile as ReturnType<typeof vi.fn>
    readFile.mockResolvedValueOnce({ path: 'src/Vehicle.java', content: 'class Vehicle {}', mtimeMs: 1 })
    readFile.mockRejectedValueOnce(new Error('read failed'))
    ;(client.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('File changed on disk'), { status: 409 }),
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await screen.findByText(/changed on disk/i)

    // Dirty buffer + a confirmed discard + a read that fails: exactly the
    // sequence Task 5 left unhandled — open()'s catch set error without
    // clearing conflict, so the stale conflict banner stayed mounted
    // alongside the new error.
    await userEvent.click(screen.getByText('src/Ticket.java'))

    expect(await screen.findByText(/read failed/i)).toBeTruthy()
    // getByRole throws if more than one match — proves the stale conflict
    // banner was cleared when open()'s own read failed.
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('loads the whole view once and renders its types', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await waitFor(() => expect(client.readViewContents).toHaveBeenCalledWith(ID, 'lld'))
    expect(await screen.findByText('node:Vehicle')).toBeTruthy()
  })

  it('updates the graph as the editor changes, without saving', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await screen.findByText('node:Vehicle')
    await userEvent.click(screen.getByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')

    await userEvent.clear(screen.getByLabelText('editor'))
    // user-event v14 treats `{`/`}` as key-sequence syntax (e.g. `{enter}`);
    // `{{` and `}}` are how you type a literal brace.
    await userEvent.type(screen.getByLabelText('editor'), 'class Bike {{}}')

    expect(await screen.findByText('node:Bike')).toBeTruthy()
    expect(client.writeFile).not.toHaveBeenCalled()
  })

  it('opens the file for a clicked node', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('node:Vehicle'))
    await waitFor(() => expect(client.readFile).toHaveBeenCalledWith(ID, 'lld', 'src/Vehicle.java'))
  })

  it('selects the node whose range contains the cursor', async () => {
    render(<Workspace client={client} projectId={ID} view="lld" onBack={vi.fn()} />)
    await screen.findByText('node:Vehicle')
    await userEvent.click(screen.getByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')

    await waitFor(() => expect(screen.getByTestId('selected').textContent).toContain('Vehicle'))
  })
})
