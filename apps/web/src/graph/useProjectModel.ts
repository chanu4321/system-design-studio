import { createParser, createProjectModel, type ProjectModel } from '@sd/parser'
import type { DiagramModel } from '@sd/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { wasmPaths } from './wasm.js'

const EMPTY: DiagramModel = { nodes: [], edges: [] }

export function useProjectModel(files: { path: string; content: string }[]): {
  model: DiagramModel
  update: (path: string, content: string) => void
} {
  const project = useRef<ProjectModel | null>(null)
  const [model, setModel] = useState<DiagramModel>(EMPTY)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const parser = await createParser(wasmPaths)
      if (cancelled) return
      project.current = createProjectModel(parser)
      setModel(project.current.setFiles(files))
    })()
    return () => {
      cancelled = true
    }
    // Rebuilding on every file-array identity change would re-parse the world on
    // each keystroke; edits arrive through update() instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = useCallback((path: string, content: string) => {
    if (!project.current) return
    setModel(project.current.updateFile(path, content))
  }, [])

  return { model, update }
}
