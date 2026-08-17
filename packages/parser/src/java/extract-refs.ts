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

// Generic-bound keywords that can appear inside `<...>` next to a real type
// (`? extends Vehicle`, `? super Vehicle`). Split out as their own tokens by
// the whitespace in `unwrapTypeNames`'s delimiter set, so they must be
// excluded explicitly — unlike `?`, `extends`/`super` pass the identifier
// regex on their own and would otherwise be emitted as fake type names.
const BOUND_KEYWORDS = new Set(['extends', 'super'])

/**
 * Every simple type name mentioned by a type expression.
 *
 * `List<ParkingSpot>` yields both the container and the argument. The container
 * is almost always a standard-library type and gets discarded during assembly
 * (it resolves against no project type); the argument is the edge that
 * matters, and is the single most common field shape in this domain.
 *
 * Splits on whitespace as well as `<>,` so a bounded wildcard's bound
 * survives as its own token (`List<? extends Vehicle>` → `List`, `Vehicle`;
 * the `?` fails the identifier test below and `extends` is filtered
 * explicitly). The same whitespace split is what lets a leading type-use
 * annotation fall away on its own: `@NonNull String` splits into `@NonNull`
 * and `String`, and `@NonNull` fails the identifier test because `@` isn't a
 * valid identifier start — no separate annotation-stripping logic needed.
 */
export function unwrapTypeNames(typeText: string): string[] {
  const out: string[] = []
  for (const raw of typeText.split(/[<>,\s]+/)) {
    const cleaned = raw.replace(/\[\]/g, '').trim()
    if (!cleaned) continue
    const simple = cleaned.slice(cleaned.lastIndexOf('.') + 1)
    if (BOUND_KEYWORDS.has(simple)) continue
    if (/^[A-Za-z_$][\w$]*$/.test(simple)) out.push(simple)
  }
  return out
}

/**
 * The innermost declaration whose line range contains this node.
 *
 * Picks the candidate with the smallest span (`endLine - line`) among those
 * whose range contains the row, because a nested declaration's range sits
 * strictly inside its enclosing one's — Task 8's `walk` always emits the
 * parent's `line`/`endLine` to cover everything nested within it. Ties are
 * broken by preferring the later `line` seen while iterating `nodes`.
 *
 * The tie-break matters for a specific, real case: a nested type that
 * starts *and* ends on the exact same line as its parent (`class Outer {
 * static class Inner extends Base {} }` all on one line) gives both
 * declarations an identical `(line, endLine)` range, so span alone can't
 * separate them — and it's not a corner case span comparison mishandles by
 * accident: equal span plus one range containing the other is only
 * geometrically possible when the two ranges are identical. `walk` (Task 8)
 * always pushes a declaration before recursing into its body, so among
 * candidates with an identical range, the one appearing later in `nodes` is
 * always the more deeply nested one. Re-verified against both a multi-line
 * and this single-line nested fixture after fixing the tie-break — an
 * earlier version of this comment claimed the single-line case had been
 * checked when it had not, and the shipped code at the time attributed it
 * to the outer declaration instead of the inner one.
 */
function ownerOf(node: SyntaxNode, nodes: ModelNode[], file: string): string | null {
  const row = node.startPosition.row + 1
  let best: ModelNode | null = null
  let bestSpan = Infinity
  for (const candidate of nodes) {
    if (candidate.file !== file) continue
    if (candidate.line === undefined || candidate.endLine === undefined) continue
    if (row < candidate.line || row > candidate.endLine) continue
    const span = candidate.endLine - candidate.line
    const better = !best || span < bestSpan || (span === bestSpan && candidate.line >= (best.line ?? 0))
    if (better) {
      best = candidate
      bestSpan = span
    }
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
