import MonacoEditor from '@monaco-editor/react'
import { useCallback, useEffect, useState } from 'react'
import type { FileEntry } from '@sd/shared'
import { FileTree } from '../components/FileTree.js'
import type { ApiClient } from '../api/client.js'

type Props = { client: ApiClient; projectId: string; onBack: () => void }

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

export function Workspace({ client, projectId, onBack }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState<string | null>(null)

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
      setFiles((await client.listFiles(projectId, 'lld')).files)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [client, projectId])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  async function open(path: string) {
    if (path === selected) return
    if (!confirmDiscard()) return
    try {
      const file = await client.readFile(projectId, 'lld', path)
      setSelected(path)
      setContent(file.content)
      setSavedContent(file.content)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function save() {
    if (!selected || !dirty) return
    try {
      await client.writeFile(projectId, 'lld', selected, content)
      setSavedContent(content)
      setError(null)
      await refreshFiles()
    } catch (err) {
      // The buffer stays dirty on purpose: a failed save must never look
      // like a successful one.
      setError(`Save failed: ${(err as Error).message}`)
    }
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
