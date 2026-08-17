import { useEffect, useMemo, useRef } from 'react'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { nodeSetChanged, type DiagramModel } from '@sd/model'
import { layout, toFlow } from './adapter.js'
import { TypeNode } from './TypeNode.js'

const nodeTypes = { type: TypeNode }

type Props = {
  model: DiagramModel
  selectedId: string | null
  onSelect: (id: string) => void
}

export function Graph({ model, selectedId, onSelect }: Props) {
  // Layout is expensive and visually disruptive, so it is recomputed only when
  // the set of types changes — never while someone types inside a method.
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const previous = useRef<DiagramModel>({ nodes: [], edges: [] })

  useEffect(() => {
    if (nodeSetChanged(previous.current, model)) {
      positions.current = layout(model)
    }
    previous.current = model
  }, [model])

  const flow = useMemo(() => toFlow(model, positions.current), [model])

  return (
    <div className="graph">
      <ReactFlow
        nodes={flow.nodes.map((n) => ({ ...n, selected: n.id === selectedId }))}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
