import { createParser, createProjectModel, type ProjectModel } from '@sd/parser'
import type { DiagramModel } from '@sd/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { wasmPaths } from './wasm.js'

const EMPTY: DiagramModel = { nodes: [], edges: [] }

export function useProjectModel(files: { path: string; content: string }[]): {
  model: DiagramModel
  update: (path: string, content: string) => void
  error: string | null
} {
  const project = useRef<ProjectModel | null>(null)
  const [model, setModel] = useState<DiagramModel>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  // Read fresh on every render so whichever `files` is current by the time
  // parser init (or a path-set change, below) actually runs is what gets
  // seeded — the real consumer (Workspace) mounts this hook with `files: []`
  // and populates it from an async effect, so the value at mount time is not
  // the value that matters.
  const filesRef = useRef(files)
  filesRef.current = files
  const pathKey = files.map((f) => f.path).sort().join('\n')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const parser = await createParser(wasmPaths)
        if (cancelled) return
        project.current = createProjectModel(parser)
        setModel(project.current.setFiles(filesRef.current))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
    // Parser initialisation runs once per mount; re-seeding when the file set
    // changes is the effect below, and content edits arrive through update()
    // — rebuilding on every file-array identity change would re-parse the
    // world on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Re-seed whenever the *set* of file paths changes — a project or view
    // loads, or a file is created or deleted — but not on every content
    // edit (those arrive through update() and must not trigger a full
    // re-parse; pathKey is derived from paths only, not content, so it does
    // not change on a keystroke). Runs on mount too, alongside the init
    // effect above, but no-ops until project.current exists — the init
    // effect's own continuation is what seeds the very first model.
    if (!project.current) return
    setModel(project.current.setFiles(filesRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey])

  const update = useCallback((path: string, content: string) => {
    if (!project.current) return
    setModel(project.current.updateFile(path, content))
  }, [])

  return { model, update, error }
}
