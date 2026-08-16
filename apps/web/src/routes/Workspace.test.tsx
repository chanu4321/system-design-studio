import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../api/client.js'
import { Workspace } from './Workspace.js'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string | undefined) => void }) => (
    <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

let client: ApiClient
beforeEach(() => {
  client = {
    listFiles: vi.fn().mockResolvedValue({ files: [{ path: 'src/Vehicle.java', size: 20 }] }),
    readFile: vi.fn().mockResolvedValue({ path: 'src/Vehicle.java', content: 'class Vehicle {}' }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn(),
    createProject: vi.fn(),
  } as unknown as ApiClient
})

describe('Workspace', () => {
  it('lists the view files on mount', async () => {
    render(<Workspace client={client} projectId={ID} onBack={vi.fn()} />)
    expect(await screen.findByText('src/Vehicle.java')).toBeTruthy()
  })

  it('loads file content into the editor when a file is selected', async () => {
    render(<Workspace client={client} projectId={ID} onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await waitFor(() =>
      expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('class Vehicle {}'),
    )
  })

  it('marks the buffer dirty on edit and clean after save', async () => {
    render(<Workspace client={client} projectId={ID} onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')

    await userEvent.type(screen.getByLabelText('editor'), ' ')
    expect(await screen.findByText(/unsaved/i)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(client.writeFile).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/unsaved/i)).toBeNull())
  })

  it('does not call writeFile when nothing changed', async () => {
    render(<Workspace client={client} projectId={ID} onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(client.writeFile).not.toHaveBeenCalled()
  })

  it('reports a save failure instead of silently discarding the edit', async () => {
    ;(client.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'))
    render(<Workspace client={client} projectId={ID} onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/unsaved/i)).toBeTruthy()
  })

  it('returns to the library when back is clicked', async () => {
    const onBack = vi.fn()
    render(<Workspace client={client} projectId={ID} onBack={onBack} />)
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

    render(<Workspace client={client} projectId={ID} onBack={vi.fn()} />)
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

    render(<Workspace client={client} projectId={ID} onBack={vi.fn()} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.click(screen.getByText('src/Ticket.java'))

    expect(confirm).not.toHaveBeenCalled()
  })

  it('prompts before leaving with unsaved changes and stays when declined', async () => {
    const onBack = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<Workspace client={client} projectId={ID} onBack={onBack} />)
    await userEvent.click(await screen.findByText('src/Vehicle.java'))
    await screen.findByLabelText('editor')
    await userEvent.type(screen.getByLabelText('editor'), ' ')

    await userEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(confirm).toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
  })
})
