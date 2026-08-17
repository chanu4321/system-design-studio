export type NodeKind =
  | 'class' | 'interface' | 'abstract' | 'enum' | 'struct'        // LLD
  | 'service' | 'datastore' | 'queue' | 'cache' | 'gateway'       // HLD, later

export type EdgeKind =
  | 'extends' | 'implements' | 'composition' | 'aggregation' | 'dependency'  // LLD
  | 'calls' | 'publishes' | 'reads' | 'replicates'                           // HLD, later

export type Visibility = 'public' | 'protected' | 'private' | 'package'

export type Field = { name: string; type: string; visibility: Visibility; static: boolean }
export type Method = {
  name: string
  returnType: string
  params: { name: string; type: string }[]
  visibility: Visibility
  static: boolean
}

export type ModelNode = {
  id: string
  name: string
  kind: NodeKind
  file?: string
  line?: number
  /** Cursor-to-node highlighting needs a range, not a start line. */
  endLine?: number
  /** This file did not parse; its previous shape is being shown. */
  stale?: boolean
  members?: { fields: Field[]; methods: Method[] }
  meta: Record<string, unknown>
}

export type ModelEdge = { from: string; to: string; kind: EdgeKind }

export type DiagramModel = { nodes: ModelNode[]; edges: ModelEdge[] }

/**
 * A reference to a type by name, before it is known whether that type is
 * defined in this project. Extraction cannot resolve these — it sees one file
 * — so it emits them and `assemble` resolves against the whole type index.
 */
export type TypeRef = {
  fromId: string
  toName: string
  kind: EdgeKind
}

/** One file's extraction result. */
export type FileModel = {
  file: string
  package?: string
  nodes: ModelNode[]
  refs: TypeRef[]
  stale?: boolean
}
