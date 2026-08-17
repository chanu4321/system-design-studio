import type { Field, Method, ModelNode, NodeKind, Visibility } from '@sd/model'

/**
 * The slice of tree-sitter's real `SyntaxNode`/`Tree` shape this module
 * relies on. Node-type and field names below (`class_declaration`,
 * `field_declaration`, `variable_declarator`, `formal_parameter`,
 * `modifiers`, `package_declaration`, and the `name`/`type`/`body`/
 * `parameters` field names) were verified against the actual grammar
 * shipped in tree-sitter-wasms@0.1.13 (tree-sitter-java ^0.20.2) by parsing
 * fixtures and reading `tree.rootNode.toString()` — not assumed from the
 * latest grammar. See packages/parser/src/tree-sitter.ts for why that
 * distinction matters for this vintage.
 */
type SyntaxNode = {
  type: string
  text: string
  startPosition: { row: number }
  endPosition: { row: number }
  namedChildren: SyntaxNode[]
  childForFieldName(name: string): SyntaxNode | null
}

const DECLARATION_KIND: Record<string, NodeKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  // Confirmed present at this grammar vintage (not dead code): a bare
  // `record Point(int x, int y) {}` parses to a `record_declaration` node
  // with the same `name`/`body` fields used generically below. Records have
  // no dedicated NodeKind, so they are modelled as classes.
  record_declaration: 'class',
}

function modifiersOf(node: SyntaxNode): string {
  // `modifiers` is a plain (unnamed-field) named child, not exposed as a
  // field — confirmed by reading the S-expression, hence the type search
  // here rather than childForFieldName('modifiers').
  return node.namedChildren.find((c) => c.type === 'modifiers')?.text ?? ''
}

function visibilityOf(node: SyntaxNode): Visibility {
  const text = modifiersOf(node)
  if (text.includes('public')) return 'public'
  if (text.includes('protected')) return 'protected'
  if (text.includes('private')) return 'private'
  return 'package'
}

function isStatic(node: SyntaxNode): boolean {
  return modifiersOf(node).includes('static')
}

function isAbstract(node: SyntaxNode): boolean {
  return modifiersOf(node).includes('abstract')
}

function bodyOf(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('body')
}

function membersOf(decl: SyntaxNode): { fields: Field[]; methods: Method[] } {
  const fields: Field[] = []
  const methods: Method[] = []
  const body = bodyOf(decl)
  if (!body) return { fields, methods }

  for (const member of body.namedChildren) {
    if (member.type === 'field_declaration') {
      const type = member.childForFieldName('type')?.text ?? ''
      // A single field_declaration can carry multiple declarators (`int a,
      // b;`) — confirmed each gets its own `declarator:` field, so
      // childForFieldName would only surface the first. Filtering
      // namedChildren by type picks up all of them.
      for (const declarator of member.namedChildren.filter((c) => c.type === 'variable_declarator')) {
        const name = declarator.childForFieldName('name')?.text
        if (!name) continue
        fields.push({ name, type, visibility: visibilityOf(member), static: isStatic(member) })
      }
    } else if (member.type === 'method_declaration') {
      const name = member.childForFieldName('name')?.text
      if (!name) continue
      const params = (member.childForFieldName('parameters')?.namedChildren ?? [])
        .filter((p) => p.type === 'formal_parameter')
        .map((p) => ({
          name: p.childForFieldName('name')?.text ?? '',
          type: p.childForFieldName('type')?.text ?? '',
        }))
      methods.push({
        name,
        returnType: member.childForFieldName('type')?.text ?? 'void',
        params,
        visibility: visibilityOf(member),
        static: isStatic(member),
      })
    }
  }
  return { fields, methods }
}

/**
 * Walks declarations, including nested ones, which get a qualified name.
 * Builder detection in a later milestone depends on the nested type existing as
 * its own node rather than being folded into its parent.
 */
function walk(node: SyntaxNode, file: string, prefix: string, out: ModelNode[]): void {
  for (const child of node.namedChildren) {
    const kind = DECLARATION_KIND[child.type]
    if (kind) {
      const simple = child.childForFieldName('name')?.text
      if (simple) {
        const name = prefix ? `${prefix}.${simple}` : simple
        out.push({
          id: `${file}#${name}`,
          name,
          kind: kind === 'class' && isAbstract(child) ? 'abstract' : kind,
          file,
          line: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          members: membersOf(child),
          meta: {},
        })
        const body = bodyOf(child)
        if (body) walk(body, file, name, out)
      }
      continue
    }
    walk(child, file, prefix, out)
  }
}

export function extractTypes(
  tree: { rootNode: SyntaxNode },
  file: string,
): { package?: string; nodes: ModelNode[] } {
  const root = tree.rootNode
  const packageNode = root.namedChildren.find((c) => c.type === 'package_declaration')
  // The package_declaration's sole child is `identifier` for a single
  // segment (`package model;`) or `scoped_identifier` for a dotted one
  // (`package com.example;`) — confirmed by parsing both. `.text` returns
  // the source substring either way, so no field-name lookup is needed.
  const pkg = packageNode?.namedChildren[0]?.text

  const nodes: ModelNode[] = []
  walk(root, file, '', nodes)

  return pkg ? { package: pkg, nodes } : { nodes }
}
