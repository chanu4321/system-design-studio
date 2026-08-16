type Props = {
  files: { path: string; size: number }[]
  selected: string | null
  onSelect: (path: string) => void
}

export function FileTree({ files, selected, onSelect }: Props) {
  if (files.length === 0) return <nav className="file-tree">No files yet.</nav>

  return (
    <nav className="file-tree">
      <ul>
        {files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              aria-current={selected === f.path ? 'true' : undefined}
              onClick={() => onSelect(f.path)}
            >
              {f.path}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
