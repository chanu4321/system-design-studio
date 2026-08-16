import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../api/client.js'
import { Library } from './Library.js'

const project = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  title: 'Parking Lot',
  path: 'parking-lot',
  tags: ['oop'],
  views: ['lld' as const],
  updatedAt: 1_700_000_000_000,
}

const stub = (over: Partial<ApiClient> = {}): ApiClient =>
  ({
    listProjects: vi.fn().mockResolvedValue({ projects: [], broken: [] }),
    createProject: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    ...over,
  }) as unknown as ApiClient

describe('Library', () => {
  it('shows an empty state when there are no projects', async () => {
    render(<Library client={stub()} onOpen={vi.fn()} />)
    expect(await screen.findByText(/no projects yet/i)).toBeTruthy()
  })

  it('renders a project card with its title and views', async () => {
    const client = stub({
      listProjects: vi.fn().mockResolvedValue({ projects: [project], broken: [] }),
    })
    render(<Library client={client} onOpen={vi.fn()} />)
    expect(await screen.findByText('Parking Lot')).toBeTruthy()
    expect(screen.getByText('LLD')).toBeTruthy()
  })

  it('surfaces broken projects instead of hiding them', async () => {
    const client = stub({
      listProjects: vi
        .fn()
        .mockResolvedValue({ projects: [], broken: [{ path: 'bad', reason: 'Malformed project.json' }] }),
    })
    render(<Library client={client} onOpen={vi.fn()} />)
    expect(await screen.findByText(/bad/)).toBeTruthy()
    expect(screen.getByText(/malformed/i)).toBeTruthy()
  })

  it('shows an error when the server is unreachable', async () => {
    const client = stub({ listProjects: vi.fn().mockRejectedValue(new Error('fetch failed')) })
    render(<Library client={client} onOpen={vi.fn()} />)
    expect(await screen.findByText(/could not reach the server/i)).toBeTruthy()
  })

  it('creates a project and refreshes the list', async () => {
    const createProject = vi.fn().mockResolvedValue(project)
    const listProjects = vi
      .fn()
      .mockResolvedValueOnce({ projects: [], broken: [] })
      .mockResolvedValueOnce({ projects: [project], broken: [] })
    const client = stub({ createProject, listProjects })

    render(<Library client={client} onOpen={vi.fn()} />)
    await screen.findByText(/no projects yet/i)

    await userEvent.type(await screen.findByLabelText(/title/i), 'Parking Lot')
    await userEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => expect(createProject).toHaveBeenCalledWith({
      title: 'Parking Lot',
      views: { lld: { language: 'java' } },
    }))
    expect(await screen.findByText('Parking Lot')).toBeTruthy()
  })

  it('calls onOpen when a card is clicked', async () => {
    const onOpen = vi.fn()
    const client = stub({
      listProjects: vi.fn().mockResolvedValue({ projects: [project], broken: [] }),
    })
    render(<Library client={client} onOpen={onOpen} />)
    await userEvent.click(await screen.findByText('Parking Lot'))
    expect(onOpen).toHaveBeenCalledWith(project.id)
  })
})
