import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileTree } from './FileTree.js'

const files = [
  { path: 'src/Vehicle.java', size: 20 },
  { path: 'src/model/Ticket.java', size: 30 },
]

describe('FileTree', () => {
  it('shows an empty state when the view has no files', () => {
    render(<FileTree files={[]} selected={null} onSelect={vi.fn()} />)
    expect(screen.getByText(/no files/i)).toBeTruthy()
  })

  it('lists every file path', () => {
    render(<FileTree files={files} selected={null} onSelect={vi.fn()} />)
    expect(screen.getByText('src/Vehicle.java')).toBeTruthy()
    expect(screen.getByText('src/model/Ticket.java')).toBeTruthy()
  })

  it('marks the selected file', () => {
    render(<FileTree files={files} selected="src/Vehicle.java" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'src/Vehicle.java' }).getAttribute('aria-current')).toBe('true')
  })

  it('calls onSelect with the clicked path', async () => {
    const onSelect = vi.fn()
    render(<FileTree files={files} selected={null} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('src/model/Ticket.java'))
    expect(onSelect).toHaveBeenCalledWith('src/model/Ticket.java')
  })
})
