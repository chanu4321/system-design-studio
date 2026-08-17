import { beforeAll, describe, expect, it } from 'vitest'
import { createParser, defaultWasmPaths, type JavaParser } from '../tree-sitter.js'
import { extractTypes } from './extract-types.js'

let parser: JavaParser
beforeAll(async () => {
  parser = await createParser(defaultWasmPaths())
})

const extract = (source: string, file = 'src/T.java') => extractTypes(parser.parse(source), file)

describe('extractTypes', () => {
  it('finds a class with its kind, id and line range', () => {
    const { nodes } = extract('class Vehicle {\n}\n')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ id: 'src/T.java#Vehicle', name: 'Vehicle', kind: 'class', file: 'src/T.java', line: 1, endLine: 2 })
  })

  it('distinguishes interface, abstract class and enum', () => {
    expect(extract('interface Movable {}').nodes[0]?.kind).toBe('interface')
    expect(extract('abstract class Shape {}').nodes[0]?.kind).toBe('abstract')
    expect(extract('enum Colour { RED }').nodes[0]?.kind).toBe('enum')
  })

  it('records the package declaration', () => {
    expect(extract('package model;\nclass A {}').package).toBe('model')
  })

  it('gives a nested type a qualified name', () => {
    const { nodes } = extract('class Outer {\n  static class Inner {}\n}')
    expect(nodes.map((n) => n.name).sort()).toEqual(['Outer', 'Outer.Inner'])
  })

  it('extracts fields with type and visibility', () => {
    const { nodes } = extract('class A {\n  private Vehicle v;\n  public static int count;\n}')
    expect(nodes[0]?.members?.fields).toEqual([
      { name: 'v', type: 'Vehicle', visibility: 'private', static: false },
      { name: 'count', type: 'int', visibility: 'public', static: true },
    ])
  })

  it('extracts methods with return type and parameters', () => {
    const { nodes } = extract('class A {\n  public Ticket park(Vehicle v, int slot) { return null; }\n}')
    expect(nodes[0]?.members?.methods).toEqual([
      {
        name: 'park',
        returnType: 'Ticket',
        params: [
          { name: 'v', type: 'Vehicle' },
          { name: 'slot', type: 'int' },
        ],
        visibility: 'public',
        static: false,
      },
    ])
  })

  it('defaults visibility to package when no modifier is present', () => {
    const { nodes } = extract('class A {\n  Vehicle v;\n}')
    expect(nodes[0]?.members?.fields[0]?.visibility).toBe('package')
  })

  it('returns no nodes for a file with no type declarations', () => {
    expect(extract('package model;').nodes).toEqual([])
  })

  it('still extracts the types it can from a file with a syntax error', () => {
    const { nodes } = extract('class A {}\nclass B { void go( }')
    expect(nodes.map((n) => n.name)).toContain('A')
  })

  it('does not let an annotation argument look like a static modifier', () => {
    const { nodes } = extract('class A {\n  @SuppressWarnings("static-access") private int x;\n}')
    expect(nodes[0]?.members?.fields[0]).toEqual({ name: 'x', type: 'int', visibility: 'private', static: false })
  })

  it('does not let an annotation argument containing "public" affect visibility', () => {
    const { nodes } = extract('class A {\n  @GuardedBy("publicLock") int x;\n}')
    expect(nodes[0]?.members?.fields[0]?.visibility).toBe('package')
  })

  it('defaults an interface method with no modifiers to public', () => {
    const { nodes } = extract('interface Movable {\n  void move();\n}')
    expect(nodes[0]?.members?.methods[0]?.visibility).toBe('public')
  })

  it('defaults an interface field with no modifiers to public and static', () => {
    const { nodes } = extract('interface Movable {\n  int MAX = 10;\n}')
    expect(nodes[0]?.members?.fields[0]).toEqual({ name: 'MAX', type: 'int', visibility: 'public', static: true })
  })

  it('still defaults a class method with no modifiers to package visibility', () => {
    const { nodes } = extract('class A {\n  void go() {}\n}')
    expect(nodes[0]?.members?.methods[0]?.visibility).toBe('package')
  })

  it('surfaces enum fields and methods declared after the constant list', () => {
    const { nodes } = extract(
      'enum Colour {\n  RED, GREEN;\n  private final String hex;\n  Colour() {}\n  String hex() { return hex; }\n}',
    )
    expect(nodes[0]?.members?.fields).toEqual([{ name: 'hex', type: 'String', visibility: 'private', static: false }])
    expect(nodes[0]?.members?.methods.map((m) => m.name)).toEqual(['hex'])
  })
})
