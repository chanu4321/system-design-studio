import { beforeAll, describe, expect, it } from 'vitest'
import { defaultWasmPaths } from './default-wasm-paths.js'
import { createParser, type JavaParser } from './tree-sitter.js'
import { createProjectModel } from './project-model.js'

let parser: JavaParser
beforeAll(async () => {
  parser = await createParser(defaultWasmPaths())
})

const files = [
  { path: 'src/Vehicle.java', content: 'class Vehicle {}' },
  { path: 'src/Car.java', content: 'class Car extends Vehicle {}' },
]

describe('createProjectModel', () => {
  it('builds a model across files with resolved edges', () => {
    const model = createProjectModel(parser).setFiles(files)
    expect(model.nodes.map((n) => n.name).sort()).toEqual(['Car', 'Vehicle'])
    expect(model.edges).toEqual([
      { from: 'src/Car.java#Car', to: 'src/Vehicle.java#Vehicle', kind: 'extends' },
    ])
  })

  it('ignores files that are not Java', () => {
    const model = createProjectModel(parser).setFiles([
      ...files,
      { path: 'README.md', content: '# notes' },
    ])
    expect(model.nodes).toHaveLength(2)
  })

  it('reflects an edited file without disturbing the others', () => {
    const project = createProjectModel(parser)
    project.setFiles(files)
    const after = project.updateFile('src/Car.java', 'class Car {}')
    expect(after.edges).toEqual([])
    expect(after.nodes.map((n) => n.name).sort()).toEqual(['Car', 'Vehicle'])
  })

  it('adds a type when a new declaration is typed', () => {
    const project = createProjectModel(parser)
    project.setFiles(files)
    const after = project.updateFile('src/Vehicle.java', 'class Vehicle {}\nclass Bike {}')
    expect(after.nodes.map((n) => n.name).sort()).toEqual(['Bike', 'Car', 'Vehicle'])
  })

  it('keeps the previous shape and marks it stale when a file stops parsing', () => {
    const project = createProjectModel(parser)
    project.setFiles(files)
    const after = project.updateFile('src/Vehicle.java', 'class Vehicle { void go( }')

    const vehicle = after.nodes.find((n) => n.name === 'Vehicle')
    expect(vehicle?.stale).toBe(true)
    // The other file's nodes and the edge into Vehicle both survive.
    expect(after.nodes.map((n) => n.name).sort()).toEqual(['Car', 'Vehicle'])
    expect(after.edges).toHaveLength(1)
  })

  it('clears stale once the file parses again', () => {
    const project = createProjectModel(parser)
    project.setFiles(files)
    project.updateFile('src/Vehicle.java', 'class Vehicle { void go( }')
    const after = project.updateFile('src/Vehicle.java', 'class Vehicle {}')
    expect(after.nodes.find((n) => n.name === 'Vehicle')?.stale).toBeUndefined()
  })

  it('current() returns the last assembled model', () => {
    const project = createProjectModel(parser)
    const built = project.setFiles(files)
    expect(project.current()).toEqual(built)
  })

  it('re-extracts exactly the one edited file, and does not parse a non-Java path at all', () => {
    let calls = 0
    const spied: JavaParser = { parse: (source) => { calls++; return parser.parse(source) } }

    const project = createProjectModel(spied)
    project.setFiles(files)
    calls = 0 // only updateFile's extraction count matters below

    project.updateFile('src/Car.java', 'class Car {}')
    // Not 2 (which a "re-parse every cached file" implementation would also
    // produce here, since there are only two files) — the assertion that
    // actually distinguishes single-file re-extraction is the exact count 1.
    expect(calls).toBe(1)

    calls = 0
    project.updateFile('README.md', '# not java, must not be parsed at all')
    expect(calls).toBe(0)
  })

  it('keeps the previous member list rather than a fresh, differently-partial extraction when a file stops parsing', () => {
    // A fresh parse of `good` yields fields [speed, name] and methods [go].
    // A fresh parse of `broken` on its own — confirmed by direct probe, see
    // the task 10 fix report — drops the method entirely under tree-sitter's
    // error recovery (fields [speed, name], methods []), while `class
    // Vehicle` itself still recovers enough to be recognised. So this
    // fixture discriminates "the stale entry kept the previous shape" from
    // "the stale entry is a fresh partial re-extraction of the broken text":
    // only the former still has `go`.
    const good = 'class Vehicle {\n  private int speed;\n  private String name;\n  void go() {}\n}'
    const broken = 'class Vehicle {\n  private int speed;\n  private String name;\n  void go(\n}'

    const project = createProjectModel(parser)
    project.setFiles([{ path: 'src/Vehicle.java', content: good }])
    const after = project.updateFile('src/Vehicle.java', broken)

    const vehicle = after.nodes.find((n) => n.name === 'Vehicle')
    expect(vehicle?.stale).toBe(true)
    expect(vehicle?.members?.fields.map((f) => f.name)).toEqual(['speed', 'name'])
    expect(vehicle?.members?.methods.map((m) => m.name)).toEqual(['go'])
  })
})
