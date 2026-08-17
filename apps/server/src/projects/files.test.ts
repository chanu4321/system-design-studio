import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES, PathEscapeError, UnsupportedFileError, listViewFiles, readViewFile, resolveInView, writeViewFile } from './files.js'

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
  // a syntax that must be rejected. This does NOT guard against an escape:
  // `relative()` cannot express a cross-device relation, so when the
  // referenced drive differs from the view's drive, the structural check
  // below already rejects it on its own (confirmed by reproducing the
  // reviewer's cross-drive scenario). What this guard actually prevents is a
  // *same-drive* semantic misreading — without it, `resolve(viewRoot, 'C:foo')`
  // silently folds to `<viewRoot>/foo`, so a caller's `C:foo` would quietly
  // come to mean `foo` instead of being refused.
  it('rejects a drive-relative path rather than silently treating it as view-relative', () => {
    expect(() => resolveInView(dir, 'lld', 'C:foo')).toThrow(/outside/i)
  })

  // Decision #3: a path that normalises to the view root itself (e.g. '.' or
  // 'src/..') is rejected the same way an empty path is. This is narrower
  // than "must always name a file, never a directory" — an ordinary
  // subdirectory such as 'src' resolves successfully through this function;
  // only the root itself is refused.
  it('rejects a path that normalises to the view root itself', () => {
    expect(() => resolveInView(dir, 'lld', '.')).toThrow(/outside/i)
    expect(() => resolveInView(dir, 'lld', 'src/..')).toThrow(/outside/i)
  })

  it('throws PathEscapeError specifically, not a plain Error', () => {
    expect(() => resolveInView(dir, 'lld', '../../x')).toThrow(PathEscapeError)
  })

  it('rejects a non-string path', () => {
    expect(() => resolveInView(dir, 'lld', 123 as unknown as string)).toThrow(PathEscapeError)
    expect(() => resolveInView(dir, 'lld', {} as unknown as string)).toThrow(PathEscapeError)
  })

  it('rejects an NTFS alternate data stream', () => {
    expect(() => resolveInView(dir, 'lld', 'src/Vehicle.java:hidden')).toThrow(PathEscapeError)
  })

  it('accepts a filename that merely begins with two dots', () => {
    expect(resolveInView(dir, 'lld', 'src/..hidden.java')).toBe(
      join(dir, 'lld', 'src', '..hidden.java'),
    )
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

describe('reparse points', () => {
  it('refuses to read through a junction that leaves the view', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'sd-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'SECRET')
    symlinkSync(outside, join(dir, 'lld', 'escape'), 'junction')

    await expect(readViewFile(dir, 'lld', 'escape/secret.txt')).rejects.toThrow(PathEscapeError)
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('refuses to write through a junction that leaves the view', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'sd-outside-'))
    symlinkSync(outside, join(dir, 'lld', 'escape2'), 'junction')

    await expect(writeViewFile(dir, 'lld', 'escape2/owned.txt', 'x')).rejects.toThrow(PathEscapeError)
    expect(existsSync(join(outside, 'owned.txt'))).toBe(false)
    rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
})

describe('file type and size guards', () => {
  it('omits unsupported extensions from the listing', async () => {
    writeFileSync(join(dir, 'lld', 'src', 'Vehicle.java'), 'class Vehicle {}')
    writeFileSync(join(dir, 'lld', 'src', 'lib.jar'), 'binary-ish')
    expect((await listViewFiles(dir, 'lld')).map((f) => f.path)).toEqual(['src/Vehicle.java'])
  })

  it('omits files over the size ceiling from the listing', async () => {
    writeFileSync(join(dir, 'lld', 'src', 'Huge.java'), 'x'.repeat(MAX_FILE_BYTES + 1))
    writeFileSync(join(dir, 'lld', 'src', 'Small.java'), 'class Small {}')
    expect((await listViewFiles(dir, 'lld')).map((f) => f.path)).toEqual(['src/Small.java'])
  })

  it('refuses to read an unsupported extension', async () => {
    writeFileSync(join(dir, 'lld', 'src', 'lib.jar'), 'x')
    await expect(readViewFile(dir, 'lld', 'src/lib.jar')).rejects.toThrow(UnsupportedFileError)
  })

  it('refuses to read a file over the size ceiling', async () => {
    writeFileSync(join(dir, 'lld', 'src', 'Huge.java'), 'x'.repeat(MAX_FILE_BYTES + 1))
    await expect(readViewFile(dir, 'lld', 'src/Huge.java')).rejects.toThrow(UnsupportedFileError)
  })

  it('refuses to write an unsupported extension', async () => {
    await expect(writeViewFile(dir, 'lld', 'src/lib.jar', 'x')).rejects.toThrow(UnsupportedFileError)
  })

  it('still accepts the supported source and text extensions', async () => {
    for (const name of ['A.java', 'b.cpp', 'c.h', 'd.md', 'e.yaml', 'f.json', 'g.txt']) {
      await writeViewFile(dir, 'lld', `src/${name}`, 'x')
    }
    expect((await listViewFiles(dir, 'lld'))).toHaveLength(7)
  })

  it('refuses to write content exceeding the size ceiling', async () => {
    const oversizedContent = 'x'.repeat(MAX_FILE_BYTES + 1)
    await expect(writeViewFile(dir, 'lld', 'src/Oversized.java', oversizedContent)).rejects.toThrow(UnsupportedFileError)
    expect(existsSync(join(dir, 'lld', 'src', 'Oversized.java'))).toBe(false)
  })

  it('accepts writes of exactly MAX_FILE_BYTES', async () => {
    const exactContent = 'x'.repeat(MAX_FILE_BYTES)
    await writeViewFile(dir, 'lld', 'src/Exact.java', exactContent)
    expect(existsSync(join(dir, 'lld', 'src', 'Exact.java'))).toBe(true)
    const written = await readViewFile(dir, 'lld', 'src/Exact.java')
    expect(written).toBe(exactContent)
  })
})
