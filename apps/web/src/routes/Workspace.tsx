import MonacoEditor from '@monaco-editor/react'
import { useCallback, useEffect, useState } from 'react'
import type { FileEntry, ViewKind } from '@sd/shared'
import { FileTree } from '../components/FileTree.js'
import { Graph } from '../graph/Graph.js'
import { useProjectModel } from '../graph/useProjectModel.js'
import type { ApiClient } from '../api/client.js'

type Props = { client: ApiClient; projectId: string; view: ViewKind; onBack: () => void }

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  java: 'java',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  h: 'cpp',
}

function monacoLanguage(path: string | null): string {
  if (!path) return 'plaintext'
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return LANGUAGE_BY_EXTENSION[ext] ?? 'plaintext'
}

export function Workspace({ client, projectId, view, onBack }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mtimeMs, setMtimeMs] = useState<number | undefined>(undefined)
  const [conflict, setConflict] = useState(false)

  // Loaded once per [client, projectId, view] — never refreshed by save() or
  // update(), so the set of paths stays stable and useProjectModel's re-seed
  // effect (keyed on that path set) does not fire on every edit. The
  // consequence: a file created outside the app is invisible to the graph
  // until the view is reopened. Acceptable for M2 — a filesystem watcher is
  // explicitly out of scope.
  const [contents, setContents] = useState<{ path: string; content: string }[]>([])

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await client.readViewContents(projectId, view)
        setContents(loaded.files.map((f) => ({ path: f.path, content: f.content })))
      } catch (err) {
        setError((err as Error).message)
      }
    })()
  }, [client, projectId, view])

  const { model, update, error: modelError } = useProjectModel(contents)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const dirty = selected !== null && content !== savedContent

  /**
   * Losing an edit by switching files or navigating away is the same silent data
   * loss as a save that lies about succeeding — and far more frequent. Ask before
   * discarding.
   */
  function confirmDiscard(): boolean {
    return !dirty || window.confirm('You have unsaved changes. Discard them?')
  }

  const refreshFiles = useCallback(async () => {
    try {
      setFiles((await client.listFiles(projectId, view)).files)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [client, projectId, view])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  async function open(path: string) {
    if (path === selected) return
    if (!confirmDiscard()) return
    try {
      const file = await client.readFile(projectId, view, path)
      setSelected(path)
      setContent(file.content)
      setSavedContent(file.content)
      setMtimeMs(file.mtimeMs)
      setConflict(false)
      setError(null)
    } catch (err) {
      // error and conflict are alternatives, never both — see the identical
      // ruling in save()'s catch below. Reachable when a save 409s (banner
      // up, buffer dirty), the user switches files and confirms the
      // discard, and that read itself fails: without clearing conflict here,
      // the stale banner would stay mounted alongside this new alert.
      setError((err as Error).message)
      setConflict(false)
    }
  }

  async function save(force = false) {
    if (!selected || !dirty) return
    try {
      await client.writeFile(projectId, view, selected, content, force ? undefined : mtimeMs)
      setSavedContent(content)
      setConflict(false)
      setError(null)
      try {
        // A failure here must never overwrite the fact that the write above
        // already succeeded. Left stale, mtimeMs at worst causes one spurious
        // conflict banner on the next save — which Reload resolves correctly,
        // since disk already holds what was just written.
        const refreshed = await client.readFile(projectId, view, selected)
        setMtimeMs(refreshed.mtimeMs)
      } catch {
        // Intentionally silent — see comment above.
      }
      await refreshFiles()
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        // The buffer stays dirty on purpose: neither version is discarded until
        // the user picks one. error and conflict are alternatives, never both.
        setConflict(true)
        setError(null)
        return
      }
      setError(`Save failed: ${(err as Error).message}`)
      setConflict(false)
    }
  }

  async function reload() {
    if (!selected) return
    try {
      const file = await client.readFile(projectId, view, selected)
      setContent(file.content)
      setSavedContent(file.content)
      setMtimeMs(file.mtimeMs)
      setConflict(false)
      setError(null)
    } catch (err) {
      // A failed reload resolves nothing — surface it rather than leaving the
      // user staring at a silent banner. conflict is cleared so the stale
      // banner doesn't render alongside this new alert; the next Save attempt
      // will re-raise the conflict on its own if it's still there.
      setError((err as Error).message)
      setConflict(false)
    }
  }

  function onEditorChange(value: string | undefined) {
    const next = value ?? ''
    setContent(next)
    setError(null)
    if (selected) update(selected, next)
  }

  function onSelectNode(id: string) {
    setSelectedNodeId(id)
    const node = model.nodes.find((n) => n.id === id)
    if (node?.file && node.file !== selected) void open(node.file)
  }

  function onCursorLine(lineNumber: number) {
    const containing = model.nodes
      .filter((n) => n.file === selected && n.line !== undefined && n.endLine !== undefined)
      .filter((n) => lineNumber >= (n.line ?? 0) && lineNumber <= (n.endLine ?? 0))
      // Innermost wins, so the cursor inside a nested type selects the nested type.
      .sort((a, b) => (b.line ?? 0) - (a.line ?? 0))[0]
    if (containing) setSelectedNodeId(containing.id)
  }

  return (
    <div className="workspace">
      <header>
        <button
          type="button"
          onClick={() => {
            if (confirmDiscard()) onBack()
          }}
        >
          Back
        </button>
        <button type="button" onClick={() => void save()} disabled={!dirty}>
          Save
        </button>
        {dirty && <span>Unsaved changes</span>}
        {error && <span role="alert">{error}</span>}
        {modelError && <span role="alert">Graph unavailable: {modelError}</span>}
      </header>

      <FileTree files={files} selected={selected} onSelect={(p) => void open(p)} />

      {conflict && (
        <div className="conflict" role="alert">
          <span>This file changed on disk.</span>
          <button type="button" onClick={() => void reload()}>
            Reload
          </button>
          <button type="button" onClick={() => void save(true)}>
            Overwrite anyway
          </button>
        </div>
      )}

      <section className="editor">
        {selected ? (
          <MonacoEditor
            height="100%"
            language={monacoLanguage(selected)}
            value={content}
            onChange={onEditorChange}
            onMount={(editor) => {
              ;(
                editor as {
                  onDidChangeCursorPosition: (
                    cb: (e: { position: { lineNumber: number } }) => void,
                  ) => void
                }
              ).onDidChangeCursorPosition((e) => onCursorLine(e.position.lineNumber))
            }}
            options={{ minimap: { enabled: false }, fontSize: 14 }}
          />
        ) : (
          <p>Select a file to start editing.</p>
        )}
      </section>

      <Graph model={model} selectedId={selectedNodeId} onSelect={onSelectNode} />
    </div>
  )
}
