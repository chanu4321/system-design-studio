import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listViewFiles, readViewFile, resolveInView, writeViewFile } from './files.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sd-files-'))
  mkdirSync(join(dir, 'lld', 'src'), { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveInView', () => {
  it('resolves a normal relative path inside the view', () => {
    expect(resolveInView(dir, 'lld', 'src/Vehicle.java')).toBe(join(dir, 'lld', 'src', 'Vehicle.java'))
  })

  it('rejects parent-directory traversal', () => {
    expect(() => resolveInView(dir, 'lld', '../../secrets.txt')).toThrow(/outside/i)
  })

  it('rejects traversal disguised by a leading segment', () => {
    expect(() => resolveInView(dir, 'lld', 'src/../../../etc/passwd')).toThrow(/outside/i)
  })

  it('rejects an absolute path', () => {
    expect(() => resolveInView(dir, 'lld', 'C:/Windows/System32/drivers/etc/hosts')).toThrow(/outside/i)
  })

  it('rejects a POSIX absolute path', () => {
    expect(() => resolveInView(dir, 'lld', '/etc/passwd')).toThrow(/outside/i)
  })

  it('rejects an empty path', () => {
    expect(() => resolveInView(dir, 'lld', '')).toThrow()
  })

  // Decision #2 in the task brief calls out drive-relative paths (`C:foo`) as
  // a syntax that must be rejected, distinct from a fully-qualified absolute
  // path. Verified experimentally: on Windows, `path.resolve` does not
  // reliably fold a drive-relative path back against the supplied base — when
  // the referenced drive differs from the view's drive, it resolves against
  // that other drive's current directory instead, landing outside the view
  // (and outside any project) without ever going through `..`. The
  // relative-path structural check alone does not catch this; it needs its
  // own guard.
  it('rejects a drive-relative path', () => {
    expect(() => resolveInView(dir, 'lld', 'C:foo')).toThrow(/outside/i)
  })

  // Decision #3: a caller must always name a file, never the directory —
  // rejected the same way whether the path is empty or merely normalises
  // back to the view root.
  it('rejects a path that normalises to the view root itself', () => {
    expect(() => resolveInView(dir, 'lld', '.')).toThrow(/outside/i)
    expect(() => resolveInView(dir, 'lld', 'src/..')).toThrow(/outside/i)
  })
})

describe('listViewFiles', () => {
  it('returns an empty list for an empty view', async () => {
    expect(await listViewFiles(dir, 'lld')).toEqual([])
  })

  it('lists files with forward-slash relative paths on every platform', async () => {
    writeFileSync(join(dir, 'lld', 'src', 'Vehicle.java'), 'class Vehicle {}')
    const files = await listViewFiles(dir, 'lld')
    expect(files.map((f) => f.path)).toEqual(['src/Vehicle.java'])
    expect(files[0]?.size).toBeGreaterThan(0)
  })

  it('ignores build output and version-control directories', async () => {
    mkdirSync(join(dir, 'lld', 'out'), { recursive: true })
    mkdirSync(join(dir, 'lld', '.git'), { recursive: true })
    writeFileSync(join(dir, 'lld', 'out', 'Vehicle.class'), 'x')
    writeFileSync(join(dir, 'lld', '.git', 'HEAD'), 'x')
    writeFileSync(join(dir, 'lld', 'src', 'Vehicle.java'), 'class Vehicle {}')
    expect((await listViewFiles(dir, 'lld')).map((f) => f.path)).toEqual(['src/Vehicle.java'])
  })

  it('returns an empty list when the view directory does not exist', async () => {
    expect(await listViewFiles(dir, 'hld')).toEqual([])
  })
})

describe('readViewFile / writeViewFile', () => {
  it('round-trips content', async () => {
    await writeViewFile(dir, 'lld', 'src/Vehicle.java', 'class Vehicle {}')
    expect(await readViewFile(dir, 'lld', 'src/Vehicle.java')).toBe('class Vehicle {}')
  })

  it('creates missing parent directories on write', async () => {
    await writeViewFile(dir, 'lld', 'src/model/Ticket.java', 'class Ticket {}')
    expect(await readFile(join(dir, 'lld', 'src', 'model', 'Ticket.java'), 'utf8')).toBe('class Ticket {}')
  })

  it('refuses to write outside the view', async () => {
    await expect(writeViewFile(dir, 'lld', '../escape.java', 'x')).rejects.toThrow(/outside/i)
  })
})
