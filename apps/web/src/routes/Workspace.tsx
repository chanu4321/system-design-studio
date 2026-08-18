import MonacoEditor from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, ViewKind } from '@sd/shared'
import type { ModelNode } from '@sd/model'
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

// The slice of Monaco's editor API this component drives directly, kept as a
// local structural type (rather than importing monaco-editor's own types) to
// match the cast already used for the cursor-position subscription below.
type EditorHandle = {
  onDidChangeCursorPosition: (cb: (e: { position: { lineNumber: number } }) => void) => void
  revealLineInCenter: (lineNumber: number) => void
  setPosition: (position: { lineNumber: number; column: number }) => void
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

  /**
   * Returns whether `path` is the open/selected file once this call settles —
   * true for the already-open short-circuit and a successful read, false when
   * the user declines the discard prompt or the read fails. onSelectNode
   * relies on this to decide whether it's safe to navigate the editor: never
   * scroll to a line in a file the user chose not to leave.
   */
  async function open(path: string): Promise<boolean> {
    if (path === selected) return true
    if (!confirmDiscard()) return false
    try {
      const file = await client.readFile(projectId, view, path)
      setSelected(path)
      setContent(file.content)
      setSavedContent(file.content)
      setMtimeMs(file.mtimeMs)
      setConflict(false)
      setError(null)
      return true
    } catch (err) {
      // error and conflict are alternatives, never both — see the identical
      // ruling in save()'s catch below. Reachable when a save 409s (banner
      // up, buffer dirty), the user switches files and confirms the
      // discard, and that read itself fails: without clearing conflict here,
      // the stale banner would stay mounted alongside this new alert.
      setError((err as Error).message)
      setConflict(false)
      return false
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

  /**
   * Spec §10: "Clicking a node opens its file at its line." open() is async
   * and may be declined via the dirty-buffer discard prompt — only reveal the
   * line once open() confirms the target file is actually the one on screen
   * (which it also reports for the already-open short-circuit, so navigation
   * still happens when the node is in the file currently open — the common
   * case for a multi-type file).
   */
  function onSelectNode(id: string) {
    setSelectedNodeId(id)
    const node = model.nodes.find((n) => n.id === id)
    if (!node?.file) return
    const file = node.file
    const line = node.line
    void (async () => {
      const opened = await open(file)
      if (opened && line !== undefined) revealLine(line)
    })()
  }

  /**
   * Same shape as packages/parser/src/java/extract-refs.ts's ownerOf: the
   * smallest span (endLine - line) wins, because a nested declaration's
   * range sits strictly inside its enclosing one's. Sorting by `line`
   * descending and taking the first match — the earlier version of this
   * function — gets the same case that function's own regression test
   * covers wrong: a nested type that opens *and* closes on its parent's
   * exact line (`class Outer { static class Inner extends Base {} }` all
   * on one line) gives both declarations an identical (line, endLine), the
   * comparator returns 0, and a stable sort leaves the parent first. Ties
   * on span are only possible when the ranges are identical, and `walk`
   * (packages/parser/src/java/extract-types.ts) always pushes a
   * declaration before recursing into its body, so among identical-range
   * candidates the later one in `model.nodes` is always the more deeply
   * nested one — hence the tie-break toward the later `line` seen.
   */
  function onCursorLine(lineNumber: number) {
    let best: ModelNode | null = null
    let bestSpan = Infinity
    for (const n of model.nodes) {
      if (n.file !== selected || n.line === undefined || n.endLine === undefined) continue
      if (lineNumber < n.line || lineNumber > n.endLine) continue
      const span = n.endLine - n.line
      const better = !best || span < bestSpan || (span === bestSpan && n.line >= (best.line ?? 0))
      if (better) {
        best = n
        bestSpan = span
      }
    }
    if (best) setSelectedNodeId(best.id)
  }

  // onMount (below) fires exactly once: Monaco does not unmount across a
  // file switch — one editor instance, one underlying model, reused — so
  // the subscription registered inside it closes over whichever
  // `onCursorLine` existed at that very first render, forever. A fresh
  // `onCursorLine` capturing the current `model`/`selected` is created
  // every render, but the frozen subscription never sees it: after
  // switching files, every cursor move keeps filtering against the file
  // that was open at mount time, silently matching nothing in any file
  // opened since. Routing the call through a ref that every render keeps
  // current sidesteps the freeze without needing to re-subscribe.
  const onCursorLineRef = useRef(onCursorLine)
  onCursorLineRef.current = onCursorLine

  // Captured in onMount below. Monaco mounts only once the editor section
  // first renders (selected !== null) — a node click can be the very first
  // file ever opened, so this can still be null when revealLine() below is
  // called. pendingLineRef carries the target line across that gap; onMount
  // flushes it the moment the editor becomes available.
  const editorRef = useRef<EditorHandle | null>(null)
  const pendingLineRef = useRef<number | null>(null)

  function revealLine(line: number) {
    const editor = editorRef.current
    if (!editor) {
      pendingLineRef.current = line
      return
    }
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
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
        {/*
         * INVARIANT: at most one role="alert" region renders at a time —
         * several tests rely on a singular getByRole('alert') query, and this
         * has already been fixed once each in save(), reload(), and open()
         * (see the "error and conflict are alternatives" comments above).
         * modelError is a fourth, independent alert source (a parser-init
         * failure from useProjectModel that is never cleared), so it only
         * renders when nothing higher-priority is showing. Priority, highest
         * first: error > conflict > modelError — a failure from something the
         * user just did (save/open/reload) or an unresolved stale-file
         * conflict is more actionable right now than the graph being stale.
         * Adding a fifth alert path? Route it through this same priority
         * chain instead of rendering unconditionally.
         */}
        {!error && !conflict && modelError && (
          <span role="alert">Graph unavailable: {modelError}</span>
        )}
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
              const handle = editor as EditorHandle
              editorRef.current = handle
              handle.onDidChangeCursorPosition((e) => onCursorLineRef.current(e.position.lineNumber))
              if (pendingLineRef.current !== null) {
                const line = pendingLineRef.current
                pendingLineRef.current = null
                handle.revealLineInCenter(line)
                handle.setPosition({ lineNumber: line, column: 1 })
              }
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
