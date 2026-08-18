import { Handle, Position } from 'reactflow'
import type { ModelNode, Visibility } from '@sd/model'

const MARKER: Record<Visibility, string> = {
  public: '+',
  protected: '#',
  private: '-',
  package: '~',
}

type Props = { data: { node: ModelNode }; selected: boolean }

export function TypeNode({ data, selected }: Props) {
  const { node } = data
  const members = node.members

  return (
    <div className={`type-node kind-${node.kind}${node.stale ? ' stale' : ''}`}>
      <Handle type="target" position={Position.Top} />

      <header>
        <span className="type-name">{node.name}</span>
        <span className="type-kind">{node.kind}</span>
        {node.stale && <span title="This file is not parsing right now">●</span>}
      </header>

      {selected && members && (
        <div className="type-members">
          <ul>
            {members.fields.map((f) => (
              <li key={f.name}>
                {MARKER[f.visibility]} {f.name}: {f.type}
              </li>
            ))}
          </ul>
          <ul>
            {members.methods.map((m) => (
              <li key={`${m.name}(${m.params.map((p) => p.type).join(',')})`}>
                {MARKER[m.visibility]} {m.name}({m.params.map((p) => `${p.name}: ${p.type}`).join(', ')}): {m.returnType}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
