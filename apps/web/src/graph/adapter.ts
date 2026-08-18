import dagre from 'dagre'
import type { DiagramModel, EdgeKind, ModelNode } from '@sd/model'

export type FlowNode = {
  id: string
  type: 'type'
  position: { x: number; y: number }
  data: { node: ModelNode }
}

export type FlowEdge = {
  id: string
  source: string
  target: string
  animated: boolean
  style: { stroke: string; strokeDasharray?: string }
  label: string
}

/** UML conventions: inheritance solid, dependency dashed. */
export const EDGE_STYLE: Record<EdgeKind, { stroke: string; dashed: boolean; arrow: string }> = {
  extends: { stroke: '#2563eb', dashed: false, arrow: 'triangle' },
  implements: { stroke: '#7c3aed', dashed: true, arrow: 'triangle' },
  composition: { stroke: '#059669', dashed: false, arrow: 'diamond' },
  aggregation: { stroke: '#0891b2', dashed: false, arrow: 'diamond-open' },
  dependency: { stroke: '#9ca3af', dashed: true, arrow: 'open' },
  calls: { stroke: '#9ca3af', dashed: false, arrow: 'open' },
  publishes: { stroke: '#9ca3af', dashed: true, arrow: 'open' },
  reads: { stroke: '#9ca3af', dashed: true, arrow: 'open' },
  replicates: { stroke: '#9ca3af', dashed: true, arrow: 'open' },
}

const NODE_WIDTH = 180
const NODE_HEIGHT = 56

/**
 * Hierarchical layout, top to bottom, so inheritance reads downward the way it
 * is drawn by hand. Called only when the set of types changes — re-running it
 * on every keystroke would make the diagram lurch while someone types.
 */
export function layout(model: DiagramModel): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of model.nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })

  // dagre ranks an edge's source above its target. Inheritance is drawn with the
  // supertype on top, and our edges point from subtype to supertype, so those go
  // in reversed. Every other kind reads with the owner on top and goes in as-is.
  for (const edge of model.edges) {
    if (edge.kind === 'extends' || edge.kind === 'implements') g.setEdge(edge.to, edge.from)
    else g.setEdge(edge.from, edge.to)
  }

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const node of model.nodes) {
    const laid = g.node(node.id)
    positions.set(node.id, {
      x: (laid?.x ?? 0) - NODE_WIDTH / 2,
      y: (laid?.y ?? 0) - NODE_HEIGHT / 2,
    })
  }
  return positions
}

export function toFlow(
  model: DiagramModel,
  positions: Map<string, { x: number; y: number }>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: model.nodes.map((node) => ({
      id: node.id,
      type: 'type' as const,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node },
    })),
    edges: model.edges.map((edge) => {
      const style = EDGE_STYLE[edge.kind]
      return {
        id: `${edge.from}->${edge.to}:${edge.kind}`,
        source: edge.from,
        target: edge.to,
        animated: false,
        style: style.dashed ? { stroke: style.stroke, strokeDasharray: '5 4' } : { stroke: style.stroke },
        label: edge.kind,
      }
    }),
  }
}
