import MonacoEditor from '@monaco-editor/react'
import { useCallback, useEffect, useState } from 'react'
import type { FileEntry, ViewKind } from '@sd/shared'
import { FileTree } from '../components/FileTree.js'
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
      setError((err as Error).message)
    }
  }

  async function save(force = false) {
    if (!selected || !dirty) return
    try {
      await client.writeFile(projectId, view, selected, content, force ? undefined : mtimeMs)
      setSavedContent(content)
      setConflict(false)
      setError(null)
      const refreshed = await client.readFile(projectId, view, selected)
      setMtimeMs(refreshed.mtimeMs)
      await refreshFiles()
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        // The buffer stays dirty on purpose: neither version is discarded until
        // the user picks one.
        setConflict(true)
        return
      }
      setError(`Save failed: ${(err as Error).message}`)
    }
  }

  async function reload() {
    if (!selected) return
    const file = await client.readFile(projectId, view, selected)
    setContent(file.content)
    setSavedContent(file.content)
    setMtimeMs(file.mtimeMs)
    setConflict(false)
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
            onChange={(value) => {
              setContent(value ?? '')
              setError(null)
            }}
            options={{ minimap: { enabled: false }, fontSize: 14 }}
          />
        ) : (
          <p>Select a file to start editing.</p>
        )}
      </section>
    </div>
  )
}
