import { beforeAll, describe, expect, it } from 'vitest'
import { createParser, defaultWasmPaths, type JavaParser } from './tree-sitter.js'
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
})
