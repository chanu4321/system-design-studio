import { useEffect, useMemo, useRef } from 'react'
import ReactFlow, { Background, Controls, useReactFlow, useUpdateNodeInternals } from 'reactflow'
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

const MAX_FIT_ATTEMPTS = 60 // ~1s at 60fps — well past any real measurement pass; a silent give-up beyond this means something else is wrong, not worth spinning forever over.

/**
 * Rendered as a child of <ReactFlow> — the only place useReactFlow and
 * useUpdateNodeInternals are valid, since <ReactFlow> supplies their context
 * to its own children, not its parent.
 *
 * Two real, hand-reproduced problems stack here, not one:
 *
 * 1. React Flow rebuilds its internal record for *every* node from
 *    `{ ...node, positionAbsolute }` whenever the `nodes` array we pass is a
 *    new reference (createNodeInternals in @reactflow/core), and our node
 *    objects never carry `width`/`height` — so passing a fresh array (needed
 *    so the graph reflects a live edit) discards every node's *previously
 *    measured* dimensions, not just the newly-added node's.
 * 2. React Flow's own ResizeObserver-driven re-measurement, which would
 *    normally recover from that, doesn't reliably re-fire for a node whose
 *    own inputs (id, data wrapper, position) happen to look unchanged to its
 *    specific NodeWrapper component. Confirmed against the real parser and
 *    browser: after typing a new, disconnected class, the new node and
 *    whichever node was selected (so genuinely re-rendered, e.g. an
 *    expanding members panel) recovered their dimensions and reappeared;
 *    every node in an untouched, unselected file stayed at
 *    `visibility: hidden` with width/height unset — forever, not just
 *    briefly. (useNodesInitialized() looked like the fix, but it checks
 *    `handleBounds`, which createNodeInternals *does* carry forward — so it
 *    reports "initialized" while width/height are still wiped, a false
 *    positive in this exact situation.)
 *
 * updateNodeInternals is React Flow's own documented escape hatch for
 * "dimensions changed outside of the normal render/observe flow": it
 * re-measures a node's real DOM element directly, sidestepping whichever
 * memoization bailout was skipping it. instance.fitView() itself returns
 * false and does nothing if any node it currently knows about isn't
 * measured yet — its own documented "not ready" signal, not a guess — so
 * retrying on the next frame until it returns true is what actually waits
 * for that measurement to land, however many frames that takes, rather than
 * guessing a fixed delay (a requestAnimationFrame-single-shot and a 100ms
 * setTimeout were both tried by hand first and both still landed on a
 * partial fit).
 *
 * generation only increases on a genuine type-set change (see Graph below),
 * so this fits then and only then — never on a content-only edit, which
 * must not yank a deliberately panned/zoomed view out from under the user.
 */
function FitOnTypeSetChange({ generation, nodeIds }: { generation: number; nodeIds: string[] }) {
  const reactFlow = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const lastFitted = useRef(0)

  useEffect(() => {
    if (generation === lastFitted.current) return
    updateNodeInternals(nodeIds)

    let cancelled = false
    let frame: number
    let attempts = 0

    function attempt() {
      if (cancelled) return
      attempts += 1
      if (reactFlow.fitView()) {
        lastFitted.current = generation
        return
      }
      if (attempts < MAX_FIT_ATTEMPTS) frame = requestAnimationFrame(attempt)
    }
    attempt()

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [generation, nodeIds, reactFlow, updateNodeInternals])

  return null
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
  // generation is bumped the same way, for the same reason, and read by
  // FitOnTypeSetChange below as the signal to re-fit.
  const positions = useRef(new Map<string, { x: number; y: number }>())
  const previous = useRef<DiagramModel>({ nodes: [], edges: [] })
  const generation = useRef(0)

  const flow = useMemo(() => {
    if (nodeSetChanged(previous.current, model)) {
      positions.current = layout(model)
      generation.current += 1
    }
    previous.current = model
    return toFlow(model, positions.current)
  }, [model])

  // Passing a brand-new nodes array (fresh objects) on every render — even
  // one where neither flow nor selectedId actually changed — forces React
  // Flow to re-evaluate every node, adding unnecessary churn on top of the
  // measurement-timing issue FitOnTypeSetChange works around. Memoized so a
  // re-render that changes neither reuses the previous array.
  const displayNodes = useMemo(
    () => flow.nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [flow, selectedId],
  )
  const nodeIds = useMemo(() => flow.nodes.map((n) => n.id), [flow])

  return (
    <div className="graph">
      <ReactFlow
        nodes={displayNodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <FitOnTypeSetChange generation={generation.current} nodeIds={nodeIds} />
      </ReactFlow>
    </div>
  )
}
