import { beforeAll, describe, expect, it } from 'vitest'
import { createParser, defaultWasmPaths, type JavaParser } from '../tree-sitter.js'
import { extractTypes } from './extract-types.js'
import { extractRefs, unwrapTypeNames } from './extract-refs.js'

let parser: JavaParser
beforeAll(async () => {
  parser = await createParser(defaultWasmPaths())
})

function refs(source: string, file = 'src/A.java') {
  const tree = parser.parse(source)
  const { nodes } = extractTypes(tree, file)
  return extractRefs(tree, file, nodes)
}

describe('unwrapTypeNames', () => {
  it('returns a plain type', () => {
    expect(unwrapTypeNames('Vehicle')).toEqual(['Vehicle'])
  })
  it('unwraps a generic argument and drops the container', () => {
    expect(unwrapTypeNames('List<ParkingSpot>')).toEqual(['List', 'ParkingSpot'])
  })
  it('unwraps nested generics', () => {
    expect(unwrapTypeNames('Map<String, List<Ticket>>')).toEqual(['Map', 'String', 'List', 'Ticket'])
  })
  it('unwraps arrays', () => {
    expect(unwrapTypeNames('Vehicle[]')).toEqual(['Vehicle'])
  })
  it('strips a qualified prefix to the simple name', () => {
    expect(unwrapTypeNames('java.util.List<Ticket>')).toEqual(['List', 'Ticket'])
  })
})

describe('extractRefs', () => {
  it('emits extends from a superclass', () => {
    expect(refs('class Car extends Vehicle {}')).toContainEqual({
      fromId: 'src/A.java#Car', toName: 'Vehicle', kind: 'extends',
    })
  })

  it('emits implements from an interface list', () => {
    expect(refs('class Car implements Movable, Parkable {}')).toEqual(
      expect.arrayContaining([
        { fromId: 'src/A.java#Car', toName: 'Movable', kind: 'implements' },
        { fromId: 'src/A.java#Car', toName: 'Parkable', kind: 'implements' },
      ]),
    )
  })

  it('emits composition when the class instantiates the field itself', () => {
    expect(refs('class Lot {\n  private Ticket t = new Ticket();\n}')).toContainEqual({
      fromId: 'src/A.java#Lot', toName: 'Ticket', kind: 'composition',
    })
  })

  it('emits composition when a constructor assigns a new instance', () => {
    expect(refs('class Lot {\n  private Ticket t;\n  Lot() { this.t = new Ticket(); }\n}')).toContainEqual({
      fromId: 'src/A.java#Lot', toName: 'Ticket', kind: 'composition',
    })
  })

  it('emits aggregation when the field arrives through a constructor parameter', () => {
    expect(refs('class Lot {\n  private Ticket t;\n  Lot(Ticket t) { this.t = t; }\n}')).toContainEqual({
      fromId: 'src/A.java#Lot', toName: 'Ticket', kind: 'aggregation',
    })
  })

  it('unwraps a generic field into an edge to the argument', () => {
    const out = refs('class Lot {\n  private List<ParkingSpot> spots;\n}')
    expect(out).toContainEqual({ fromId: 'src/A.java#Lot', toName: 'ParkingSpot', kind: 'aggregation' })
  })

  it('emits dependency for a type used only in a method signature', () => {
    expect(refs('class Lot {\n  Ticket park(Vehicle v) { return null; }\n}')).toEqual(
      expect.arrayContaining([
        { fromId: 'src/A.java#Lot', toName: 'Vehicle', kind: 'dependency' },
        { fromId: 'src/A.java#Lot', toName: 'Ticket', kind: 'dependency' },
      ]),
    )
  })

  it('emits dependency for a local instantiation', () => {
    expect(refs('class Lot {\n  void go() { Vehicle v = new Vehicle(); }\n}')).toContainEqual({
      fromId: 'src/A.java#Lot', toName: 'Vehicle', kind: 'dependency',
    })
  })

  it('attributes a nested type its own references', () => {
    const out = refs('class Outer {\n  static class Inner extends Base {}\n}')
    expect(out).toContainEqual({ fromId: 'src/A.java#Outer.Inner', toName: 'Base', kind: 'extends' })
  })

  it('emits nothing for a file with no types', () => {
    expect(refs('package model;')).toEqual([])
  })

  it('interface constants also produce reference edges', () => {
    const out = refs('interface Config {\n  Vehicle DEFAULT = new Vehicle();\n}')
    expect(out).toContainEqual({ fromId: 'src/A.java#Config', toName: 'Vehicle', kind: 'composition' })
  })

  // `instantiated` is scoped per owning declaration, not per file: two
  // classes declared in the same file that both have a field of the same
  // type must be judged independently. If the set were file-wide, A's field
  // (never instantiated by A) would be misread as composition just because
  // B happens to `new` the same type elsewhere in the file.
  it('does not let one class\'s instantiation make another class\'s same-type field look self-owned', () => {
    const out = refs('class A {\n  private Ticket t;\n}\nclass B {\n  private Ticket t = new Ticket();\n}')
    expect(out).toContainEqual({ fromId: 'src/A.java#A', toName: 'Ticket', kind: 'aggregation' })
    expect(out).toContainEqual({ fromId: 'src/A.java#B', toName: 'Ticket', kind: 'composition' })
  })
})
