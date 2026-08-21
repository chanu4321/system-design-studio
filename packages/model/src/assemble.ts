import type { DiagramModel, EdgeKind, FileModel, ModelEdge, ModelNode } from './types.js'

/** Strongest first. Every EdgeKind must appear; see the exhaustiveness test. */
export const EDGE_STRENGTH: readonly EdgeKind[] = [
  'extends', 'implements', 'composition', 'aggregation', 'dependency',
  'calls', 'publishes', 'reads', 'replicates',
]

function stronger(a: EdgeKind, b: EdgeKind): EdgeKind {
  return EDGE_STRENGTH.indexOf(a) <= EDGE_STRENGTH.indexOf(b) ? a : b
}

export function assemble(files: FileModel[]): DiagramModel {
  const nodes: ModelNode[] = []
  const packageOf = new Map<string, string | undefined>()
  // Simple name → every node declaring it. Collisions are resolved per-referrer.
  const byName = new Map<string, ModelNode[]>()

  for (const f of files) {
    for (const node of f.nodes) {
      const withMeta: ModelNode = {
        ...node,
        ...(f.namespace === undefined ? {} : { namespace: f.namespace }),
        ...(f.stale ? { stale: true } : {}),
      }
      nodes.push(withMeta)
      packageOf.set(withMeta.id, f.namespace)
      const list = byName.get(withMeta.name)
      if (list) list.push(withMeta)
      else byName.set(withMeta.name, [withMeta])
    }
  }

  const best = new Map<string, ModelEdge>()

  for (const f of files) {
    for (const ref of f.refs) {
      const candidates = byName.get(ref.toName)
      // Not defined in this project — standard library or an import. Ignored.
      if (!candidates || candidates.length === 0) continue

      let target = candidates[0]
      if (candidates.length > 1) {
        const fromPackage = packageOf.get(ref.fromId)
        const samePackage = candidates.filter((c) => packageOf.get(c.id) === fromPackage)
        // Ambiguous with no package to disambiguate: a wrong edge is worse than
        // a missing one, so draw nothing.
        if (samePackage.length !== 1) continue
        target = samePackage[0]
      }
      if (!target || target.id === ref.fromId) continue

      const key = `${ref.fromId}\u0000${target.id}`
      const existing = best.get(key)
      best.set(key, {
        from: ref.fromId,
        to: target.id,
        kind: existing ? stronger(existing.kind, ref.kind) : ref.kind,
      })
    }
  }

  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const edges = [...best.values()].sort((a, b) =>
    a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1,
  )

  return { nodes, edges }
}

/**
 * Whether the set of types changed, which is the only reason to recompute
 * layout. Editing inside a method body must never reshuffle the diagram.
 */
export function nodeSetChanged(a: DiagramModel, b: DiagramModel): boolean {
  if (a.nodes.length !== b.nodes.length) return true
  const ids = new Set(a.nodes.map((n) => n.id))
  return b.nodes.some((n) => !ids.has(n.id))
}
