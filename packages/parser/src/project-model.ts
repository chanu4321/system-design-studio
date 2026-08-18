import { assemble, type DiagramModel, type FileModel } from '@sd/model'
import { extractRefs } from './java/extract-refs.js'
import { extractTypes } from './java/extract-types.js'
import type { JavaParser } from './tree-sitter.js'

export type ProjectModel = {
  setFiles(files: { path: string; content: string }[]): DiagramModel
  updateFile(path: string, content: string): DiagramModel
  current(): DiagramModel
}

const isJava = (path: string) => path.toLowerCase().endsWith('.java')

/**
 * Holds one extraction result per file.
 *
 * A keystroke re-extracts exactly one file and re-assembles; every other file's
 * result is reused. Assembly is cheap because it is pure index lookups over
 * already-extracted references.
 */
export function createProjectModel(parser: JavaParser): ProjectModel {
  const byFile = new Map<string, FileModel>()
  let model: DiagramModel = { nodes: [], edges: [] }

  function extract(path: string, content: string): FileModel {
    const tree = parser.parse(content)
    const { package: pkg, nodes } = extractTypes(tree, path)

    // A file mid-edit keeps its previous shape rather than vanishing from the
    // graph, so a single broken keystroke never blanks the diagram.
    if (tree.rootNode.hasError) {
      const previous = byFile.get(path)
      if (previous) return { ...previous, stale: true }
      return pkg
        ? { file: path, package: pkg, nodes, refs: extractRefs(tree, path, nodes), stale: true }
        : { file: path, nodes, refs: extractRefs(tree, path, nodes), stale: true }
    }

    const refs = extractRefs(tree, path, nodes)
    return pkg ? { file: path, package: pkg, nodes, refs } : { file: path, nodes, refs }
  }

  function rebuild(): DiagramModel {
    model = assemble([...byFile.values()])
    return model
  }

  return {
    setFiles(files) {
      byFile.clear()
      for (const f of files) {
        if (!isJava(f.path)) continue
        byFile.set(f.path, extract(f.path, f.content))
      }
      return rebuild()
    },

    updateFile(path, content) {
      if (!isJava(path)) return model
      byFile.set(path, extract(path, content))
      return rebuild()
    },

    current: () => model,
  }
}
