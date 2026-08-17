import type { ModelNode, TypeRef } from '@sd/model'

/**
 * The slice of tree-sitter's real `SyntaxNode`/`Tree` shape this module
 * relies on. Node-type names below (`superclass`, `super_interfaces`,
 * `object_creation_expression`, `local_variable_declaration`, and the reused
 * `field_declaration`/`constant_declaration` pair from Task 8) were verified
 * against the actual grammar shipped in tree-sitter-wasms@0.1.13
 * (tree-sitter-java ^0.20.2) by parsing fixtures and reading
 * `tree.rootNode.toString()` — see packages/parser/src/tree-sitter.ts for why
 * that vintage cannot be assumed from the latest grammar spec.
 */
type SyntaxNode = {
  type: string
  text: string
  startPosition: { row: number }
  endPosition: { row: number }
  namedChildren: SyntaxNode[]
  childForFieldName(name: string): SyntaxNode | null
}

/**
 * Every simple type name mentioned by a type expression.
 *
 * `List<ParkingSpot>` yields both the container and the argument. The container
 * is almost always a standard-library type and gets discarded during assembly
 * (it resolves against no project type); the argument is the edge that
 * matters, and is the single most common field shape in this domain.
 */
export function unwrapTypeNames(typeText: string): string[] {
  const out: string[] = []
  for (const raw of typeText.split(/[<>,]/)) {
    const cleaned = raw.replace(/\[\]/g, '').trim()
    if (!cleaned) continue
    const simple = cleaned.slice(cleaned.lastIndexOf('.') + 1)
    if (/^[A-Za-z_$][\w$]*$/.test(simple)) out.push(simple)
  }
  return out
}

/**
 * The innermost declaration whose line range contains this node — confirmed
 * by parsing `class Outer { static class Inner extends Base {} }` and
 * checking that the `extends Base` reference attributes to `Outer.Inner`,
 * not `Outer`. Depends on Task 8's `line`/`endLine` ranges, which enclose
 * nested declarations within their parent's range, so "innermost" means
 * "latest-starting among those that contain this row."
 */
function ownerOf(node: SyntaxNode, nodes: ModelNode[], file: string): string | null {
  const row = node.startPosition.row + 1
  let best: ModelNode | null = null
  for (const candidate of nodes) {
    if (candidate.file !== file) continue
    if (candidate.line === undefined || candidate.endLine === undefined) continue
    if (row < candidate.line || row > candidate.endLine) continue
    if (!best || (best.line ?? 0) < candidate.line) best = candidate
  }
  return best?.id ?? null
}

function descendants(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  const stack = [...node.namedChildren]
  while (stack.length) {
    const next = stack.pop()
    if (!next) continue
    out.push(next)
    stack.push(...next.namedChildren)
  }
  return out
}

export function extractRefs(tree: { rootNode: SyntaxNode }, file: string, nodes: ModelNode[]): TypeRef[] {
  const refs: TypeRef[] = []
  const all = descendants(tree.rootNode)

  const push = (fromId: string | null, typeText: string, kind: TypeRef['kind']) => {
    if (!fromId) return
    for (const toName of unwrapTypeNames(typeText)) refs.push({ fromId, toName, kind })
  }

  // (owning declaration, type name) pairs the declaration instantiates
  // itself, anywhere within its own line range (field initialiser,
  // constructor body, method body, ...).
  //
  // Scoped per owning declaration rather than file-wide: a class is judged
  // by whether *it* creates the value, not by whether anything else in the
  // file does. Two classes declared in the same file that both have a field
  // of the same type must be judged independently — one calling `new` for
  // its own field must not make the other class's unrelated field of the
  // same type name look self-owned. A file-wide set would conflate them
  // whenever two declarations in one file share a field's type name and
  // only one instantiates it.
  const instantiated = new Set<string>()
  for (const node of all) {
    if (node.type !== 'object_creation_expression') continue
    const created = node.childForFieldName('type')?.text.trim()
    const owner = ownerOf(node, nodes, file)
    if (created && owner) instantiated.add(`${owner}\u0000${created}`)
  }

  for (const node of all) {
    switch (node.type) {
      case 'superclass':
        push(ownerOf(node, nodes, file), node.text.replace(/^extends\s+/, ''), 'extends')
        break

      case 'super_interfaces':
        push(ownerOf(node, nodes, file), node.text.replace(/^implements\s+/, ''), 'implements')
        break

      // Interface fields parse as `constant_declaration`, not
      // `field_declaration` — established by Task 8's own parse. Matching
      // only the latter silently drops every reference declared on an
      // interface constant.
      case 'field_declaration':
      case 'constant_declaration': {
        const owner = ownerOf(node, nodes, file)
        const typeText = node.childForFieldName('type')?.text ?? ''
        // Composition when the owning declaration creates the value itself;
        // otherwise the value arrived from outside, which is aggregation.
        const owns = owner !== null && unwrapTypeNames(typeText).some((n) => instantiated.has(`${owner}\u0000${n}`))
        push(owner, typeText, owns ? 'composition' : 'aggregation')
        break
      }

      case 'method_declaration': {
        const owner = ownerOf(node, nodes, file)
        push(owner, node.childForFieldName('type')?.text ?? '', 'dependency')
        for (const param of node.childForFieldName('parameters')?.namedChildren ?? []) {
          push(owner, param.childForFieldName('type')?.text ?? '', 'dependency')
        }
        break
      }

      case 'local_variable_declaration':
        push(ownerOf(node, nodes, file), node.childForFieldName('type')?.text ?? '', 'dependency')
        break
    }
  }

  return refs
}
