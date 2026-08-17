import { useMemo, useRef } from 'react'
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
  // Layout is expensive and visually disruptive, so it is recomputed only
  // when the set of types changes — never while someone types inside a
  // method. Positions live in a ref (not state), and are (re)computed inside
  // this memo's render-phase body rather than in a useEffect: an effect runs
  // after render, so a ref write there is always one render behind whatever
  // this memo reads on the render that follows it — the first non-empty
  // model would render every node stacked at the origin, and every
  // subsequent type-set change would render the *previous* model's layout.
  // Writing the ref during render is safe here because the write is
  // idempotent for a given model (a StrictMode double-render sees
  // nodeSetChanged(model, model) === false on its second pass) and layout is
  // pure, so a discarded/re-run render cannot leave the pair inconsistent.
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const previous = useRef<DiagramModel>({ nodes: [], edges: [] })

  const flow = useMemo(() => {
    if (nodeSetChanged(previous.current, model)) positions.current = layout(model)
    previous.current = model
    return toFlow(model, positions.current)
  }, [model])

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
