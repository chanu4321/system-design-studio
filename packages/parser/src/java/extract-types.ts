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
  children: SyntaxNode[]
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

const KEYWORD_MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'abstract'])

/**
 * The modifiers node's own `.text` is NOT a safe substring-match target: it
 * includes annotation subtrees verbatim, and an annotation's string-literal
 * argument can contain any of the keywords below.
 * `@SuppressWarnings("static-access") private int x;` produces a modifiers
 * node whose `.text` is `@SuppressWarnings("static-access") private` —
 * matching "static" against that text falsely marks a non-static field as
 * static. Confirmed by parsing that fixture and printing every child
 * (named and anonymous) of the modifiers node.
 *
 * The actual keyword tokens (`public`, `static`, `abstract`, ...) are
 * anonymous children of `modifiers` — their own node `type` IS the literal
 * keyword — sitting alongside `annotation`/`marker_annotation` subtrees
 * that carry no such type. Reading `children` (not `namedChildren`, which
 * excludes anonymous tokens) and testing exact `type` membership against a
 * known keyword set is immune to whatever text an annotation carries,
 * because an annotation node's type is never one of these literal strings.
 */
function modifierKeywords(node: SyntaxNode): Set<string> {
  const modifiers = node.namedChildren.find((c) => c.type === 'modifiers')
  if (!modifiers) return new Set()
  return new Set(modifiers.children.map((c) => c.type).filter((t) => KEYWORD_MODIFIERS.has(t)))
}

/**
 * Java's implicit-visibility rule: a member of an interface with no
 * explicit visibility keyword is public (this is the common case — writing
 * `public` on an interface method is redundant and rare in real code).
 * `implicitPublic` should be true only when the declaring type is an
 * interface; everywhere else, no modifier means package-private.
 */
function visibilityOf(node: SyntaxNode, implicitPublic = false): Visibility {
  const keywords = modifierKeywords(node)
  if (keywords.has('public')) return 'public'
  if (keywords.has('protected')) return 'protected'
  if (keywords.has('private')) return 'private'
  return implicitPublic ? 'public' : 'package'
}

/**
 * `implicitStatic` should be true only for interface fields (all fields
 * declared in an interface body are implicitly static constants per the
 * JLS) — never for interface methods, which are not implicitly static.
 */
function isStatic(node: SyntaxNode, implicitStatic = false): boolean {
  return modifierKeywords(node).has('static') || implicitStatic
}

function isAbstract(node: SyntaxNode): boolean {
  return modifierKeywords(node).has('abstract')
}

function bodyOf(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('body')
}

/**
 * Recurses into a body-like node's members, accumulating into `fields`/
 * `methods`. Called once for a normal class/interface/enum body, and again
 * (self-recursively) for an `enum_body_declarations` wrapper — see the note
 * below.
 */
function collectMembers(bodyNode: SyntaxNode, isInterface: boolean, fields: Field[], methods: Method[]): void {
  for (const member of bodyNode.namedChildren) {
    if (member.type === 'enum_body_declarations') {
      // Enum members declared after the `;` separator (fields,
      // constructors, methods) are not direct children of enum_body — they
      // are wrapped in one enum_body_declarations node. Confirmed by
      // parsing `enum Colour { RED, GREEN; private final String hex;
      // Colour() {} String hex() { return hex; } }`: without unwrapping
      // this wrapper, a flat pass over enum_body's namedChildren finds only
      // the enum_constants and silently drops the field/constructor/method
      // entirely. `walk`'s generic recursion already finds any nested type
      // declaration inside this wrapper on its own, so only member
      // collection needs the unwrap.
      collectMembers(member, isInterface, fields, methods)
      continue
    }
    // Interface fields do not parse as field_declaration at all — they use
    // a distinct constant_declaration node type (grammatically, only
    // interface bodies can contain one), confirmed by parsing
    // `interface Movable { int MAX = 10; }`. Both shapes carry the same
    // `type` field and one-or-more `declarator` fields, so they are
    // extracted identically here.
    if (member.type === 'field_declaration' || member.type === 'constant_declaration') {
      const type = member.childForFieldName('type')?.text ?? ''
      // A single field_declaration can carry multiple declarators (`int a,
      // b;`) — confirmed each gets its own `declarator:` field, so
      // childForFieldName would only surface the first. Filtering
      // namedChildren by type picks up all of them.
      for (const declarator of member.namedChildren.filter((c) => c.type === 'variable_declarator')) {
        const name = declarator.childForFieldName('name')?.text
        if (!name) continue
        fields.push({
          name,
          type,
          visibility: visibilityOf(member, isInterface),
          // All interface fields are implicitly static constants per the
          // JLS, regardless of whether `static` is written explicitly.
          static: isStatic(member, isInterface),
        })
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
        visibility: visibilityOf(member, isInterface),
        // Unlike fields, interface methods are never implicitly static.
        static: isStatic(member, false),
      })
    }
  }
}

function membersOf(decl: SyntaxNode): { fields: Field[]; methods: Method[] } {
  const fields: Field[] = []
  const methods: Method[] = []
  const body = bodyOf(decl)
  if (!body) return { fields, methods }

  collectMembers(body, decl.type === 'interface_declaration', fields, methods)
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
