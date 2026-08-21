import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { materialise } from './materialise.js'

// Every test gets its own root via mkdtemp so writes from one test can never
// be mistaken for another's. Collected here and swept up once at the end —
// same reasoning as packages/store/src/sqlite.test.ts: cleanup is
// housekeeping, not the behaviour under test, and a single best-effort pass
// avoids burning time on Windows file-lock retries for handles the OS will
// reclaim on its own anyway.
const roots: string[] = []

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mat-'))
  roots.push(root)
  return root
}

afterAll(async () => {
  await Promise.all(
    roots.map(async (root) => {
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 0 })
      } catch {
        // Handle still held, or already gone. Nothing worth failing a suite over.
      }
    }),
  )
})

describe('materialise', () => {
  it('places a file under its declared package, ignoring its source path', async () => {
    const root = await freshRoot()
    const written = await materialise(
      [{ path: 'lld/src/Main.java', content: 'package com.example;\nclass Main {}\n' }],
      root,
    )
    expect(written[0]).toBe(join(root, 'com', 'example', 'Main.java'))
    expect(await readFile(written[0]!, 'utf8')).toContain('class Main')
  })

  it('places a default-package file at the root', async () => {
    const root = await freshRoot()
    const written = await materialise([{ path: 'deep/nested/Main.java', content: 'class Main {}\n' }], root)
    expect(written[0]).toBe(join(root, 'Main.java'))
  })

  // Ruling K (task-6-brief.md): the brief's original third test asserted
  // that `../evil.java` makes materialise() throw. It cannot, and this was
  // verified by execution, not just reasoning. The implementation writes to
  // `join(dir, basename(file.path))`, and `basename('../evil.java')` is
  // `'evil.java'` — the traversal is stripped before the guard ever sees it,
  // the resolved target lands inside `root`, `relative(root, target)` comes
  // back as `'evil.java'` (no leading `..`), and the guard's condition is
  // false. Nothing throws. This test asserts the guarantee that actually
  // holds: a traversal-shaped source path is neutralised by `basename()`
  // rather than being allowed to write outside the run directory.
  it('neutralises a traversal in the source path rather than writing outside the run directory', async () => {
    const root = await freshRoot()
    const written = await materialise([{ path: '../../evil.java', content: 'class E {}' }], root)
    expect(written[0]).toBe(join(root, 'evil.java'))
    expect(relative(root, written[0]!).startsWith('..')).toBe(false)
  })

  // Genuine discovery made while implementing this task (see task-6-report.md):
  // the guard IS reachable, just not via a leading `../` — `basename()` only
  // strips separators, it does not collapse `..` segments. When a source
  // path's *last* segment is literally `..` (no filename follows it),
  // `basename()` hands that `..` straight through unchanged, so
  // `join(dir, '..')` walks back out of `dir` and the guard correctly
  // throws before anything is written.
  it('throws when the source path itself is a bare traversal segment', async () => {
    const root = await freshRoot()
    await expect(materialise([{ path: '..', content: 'class E {}' }], root)).rejects.toThrow(
      /Refusing to write outside the run directory/,
    )
  })

  // Round-1 review, Finding 1 (Important): the guard used to be a string
  // PREFIX check (`rel.startsWith('..')`), which also rejected a file
  // honestly named with a leading `..` — its relative path's *text* starts
  // with two dots while the file stays safely inside `root`. Verified by
  // execution against the pre-fix code (see task-6-report.md): both
  // `'..hidden.java'` and `'....java'` threw "Refusing to write outside the
  // run directory" before the fix, even though neither escapes anything.
  // Fixed to check for an actual `..` path *segment*
  // (`rel === '..' || rel.startsWith('..' + sep)`) instead of a substring.
  it('writes a file honestly named with a leading ".." rather than rejecting it as an escape', async () => {
    const root = await freshRoot()
    const written = await materialise([{ path: '..hidden.java', content: 'class Hidden {}\n' }], root)
    expect(written[0]).toBe(join(root, '..hidden.java'))
    expect(await readFile(written[0]!, 'utf8')).toContain('class Hidden')
  })

  it('writes a file whose name is only dots when it is not actually a traversal segment', async () => {
    const root = await freshRoot()
    const written = await materialise([{ path: '....java', content: 'class Dots {}\n' }], root)
    expect(written[0]).toBe(join(root, '....java'))
  })

  // Round-1 review, Finding 3 (Minor): `path: '.'` used to slip past the
  // guard entirely. `basename('.')` is `'.'`, so `target` collapsed to
  // `dir` itself (the run directory, or the package directory),
  // `relative(root, target)` came back as `''` (no leading `..`), and the
  // guard's condition was false. `writeFile` then threw a raw `EISDIR` that
  // named the wrong problem. Verified by execution against the pre-fix code
  // (see task-6-report.md). The guard now rejects a source path that does
  // not resolve to a file name before `writeFile` is ever reached.
  it('rejects a source path that does not resolve to a file name, rather than failing later with EISDIR', async () => {
    const root = await freshRoot()
    await expect(materialise([{ path: '.', content: 'class Dot {}' }], root)).rejects.toThrow(
      /does not name a file/,
    )
  })

  it('keeps two same-named classes in different packages apart', async () => {
    const root = await freshRoot()
    const written = await materialise(
      [
        { path: 'a/Main.java', content: 'package one;\nclass Main {}\n' },
        { path: 'b/Main.java', content: 'package two;\nclass Main {}\n' },
      ],
      root,
    )
    expect(new Set(written).size).toBe(2)
    expect(written[0]).toBe(join(root, 'one', 'Main.java'))
    expect(written[1]).toBe(join(root, 'two', 'Main.java'))
    expect(await readFile(written[0]!, 'utf8')).toContain('package one')
    expect(await readFile(written[1]!, 'utf8')).toContain('package two')
  })

  it('returns written paths in input order so callers can zip them against the request', async () => {
    const root = await freshRoot()
    const written = await materialise(
      [
        { path: 'z/Z.java', content: 'package z;\nclass Z {}\n' },
        { path: 'a/A.java', content: 'package a;\nclass A {}\n' },
        { path: 'Loose.java', content: 'class Loose {}\n' },
      ],
      root,
    )
    expect(written).toEqual([join(root, 'z', 'Z.java'), join(root, 'a', 'A.java'), join(root, 'Loose.java')])
  })
})

// Round-1 review, Finding 2 (Important): the original PACKAGE regex had no
// notion of comments, so a block-commented leftover package line — an
// ordinary refactoring artifact, not an adversarial input — was matched
// instead of the real declaration. Verified by execution against the
// pre-fix code (see task-6-report.md): the first fixture below resolved to
// `com/wrong/Main.java` before the fix.
//
// This mismatch matters beyond misfiling: the model derives the same
// package fact via tree-sitter for Task 15's entry-point fully-qualified
// name. If this regex-based derivation disagreed with the model's, the
// class would compile into one directory while `java` is asked for a name
// in another — surfacing to the user as a ClassNotFoundException that reads
// like a bug in their code, not ours.
describe('materialise — package detection ignores commented-out declarations', () => {
  it('ignores a commented-out package declaration with no per-line comment prefix', async () => {
    const root = await freshRoot()
    const content = '/*\npackage com.wrong;\n*/\npackage com.example;\nclass Main {}\n'
    const written = await materialise([{ path: 'Main.java', content }], root)
    expect(written[0]).toBe(join(root, 'com', 'example', 'Main.java'))
  })

  it('ignores a package declaration commented out with //', async () => {
    const root = await freshRoot()
    const content = '// package com.wrong;\npackage com.example;\nclass Main {}\n'
    const written = await materialise([{ path: 'Main.java', content }], root)
    expect(written[0]).toBe(join(root, 'com', 'example', 'Main.java'))
  })

  it('picks the real declaration past a license header block comment', async () => {
    const root = await freshRoot()
    const content = [
      '/*',
      ' * Copyright 2024 Example Corp.',
      ' * Licensed under the Apache License, Version 2.0.',
      ' */',
      'package com.example;',
      'class Main {}',
      '',
    ].join('\n')
    const written = await materialise([{ path: 'Main.java', content }], root)
    expect(written[0]).toBe(join(root, 'com', 'example', 'Main.java'))
  })

  // Pinned, not new behaviour: the original regex already skipped this case
  // because the Javadoc line starts with `*`, not whitespace-then-`package`
  // — `^\s*package` never matched it, even before comment stripping
  // existed. Kept as a regression test so the comment-stripping rewrite
  // cannot break what already worked.
  it('ignores a package-shaped line inside a Javadoc comment', async () => {
    const root = await freshRoot()
    const content = ['/**', ' * package com.wrong;', ' */', 'package com.example;', 'class Main {}', ''].join('\n')
    const written = await materialise([{ path: 'Main.java', content }], root)
    expect(written[0]).toBe(join(root, 'com', 'example', 'Main.java'))
  })

  it('still lands at the root when there is no package declaration at all', async () => {
    const root = await freshRoot()
    const content = '// no package here, just a comment\nclass Main {}\n'
    const written = await materialise([{ path: 'Main.java', content }], root)
    expect(written[0]).toBe(join(root, 'Main.java'))
  })
})
