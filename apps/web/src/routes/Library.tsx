import { useCallback, useEffect, useState } from 'react'
import type { ProjectListResponse } from '@sd/shared'
import type { ApiClient } from '../api/client.js'

type Props = { client: ApiClient; onOpen: (id: string) => void }

export function Library({ client, onOpen }: Props) {
  const [data, setData] = useState<ProjectListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setData(await client.listProjects())
      setError(null)
    } catch {
      setError('Could not reach the server. Is it running on port 5174?')
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await client.createProject({ title: title.trim(), views: { lld: { language: 'java' } } })
      setTitle('')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="library">
      <header>
        <h1>System Design</h1>
        <form onSubmit={onCreate}>
          <label htmlFor="new-title">Title</label>
          <input
            id="new-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Parking Lot"
          />
          <button type="submit" disabled={busy}>
            Create
          </button>
        </form>
      </header>

      {error && <p role="alert">{error}</p>}

      {data && data.projects.length === 0 && !error && <p>No projects yet.</p>}

      <ul className="grid">
        {data?.projects.map((p) => (
          <li key={p.id}>
            <button type="button" className="card" onClick={() => onOpen(p.id)}>
              <span className="card-title">{p.title}</span>
              <span className="badges">
                {p.views.map((v) => (
                  <em key={v}>{v.toUpperCase()}</em>
                ))}
              </span>
              <span className="tags">{p.tags.join(', ')}</span>
            </button>
          </li>
        ))}
      </ul>

      {data && data.broken.length > 0 && (
        <section className="broken">
          <h2>Could not be loaded</h2>
          <ul>
            {data.broken.map((b) => (
              <li key={b.path}>
                <code>{b.path}</code> — {b.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
