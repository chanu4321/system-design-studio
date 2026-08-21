import { execFile } from 'node:child_process'
import type { RunnerBackend, RunRequest, RunResult } from './types.js'

// Long enough that a slow-starting JVM on a loaded machine still reports in,
// short enough that a hung or missing binary does not stall `available()`.
const VERSION_CHECK_TIMEOUT_MS = 5_000

/**
 * Resolves `bin` by asking it for its version and reporting whether that
 * succeeded. A binary that is missing from PATH fails to spawn at all
 * (`ENOENT`); one that hangs is killed by the timeout. Both are reported as
 * "not available" — neither is allowed to throw out of here, because a
 * missing toolchain is a normal, reportable condition for `available()`, not
 * an exceptional one for its caller to catch.
 */
function resolves(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: VERSION_CHECK_TIMEOUT_MS }, (error) => {
      resolve(error == null)
    })
  })
}

/**
 * Runner backed by the JDK installed on this machine: `javac` compiles,
 * `java` runs.
 *
 * `bins` overrides which executables are invoked, defaulting to the bare
 * names `'javac'` and `'java'` resolved via PATH. This exists so tests can
 * point at a binary that does not exist — there is no way to uninstall the
 * JDK for the duration of a test run, so the "toolchain missing" branch of
 * `available()` has no other way to be exercised. Same shape and same reason
 * as `createScanCache`'s injected `scan` function in
 * `apps/server/src/projects/cache.ts`: production always gets the real
 * default, and tests substitute the one part of the world they cannot
 * otherwise control.
 */
export function createLocalBackend(bins?: { javac?: string; java?: string }): RunnerBackend {
  const javac = bins?.javac ?? 'javac'
  const java = bins?.java ?? 'java'

  return {
    async available(): Promise<boolean> {
      const [javacOk, javaOk] = await Promise.all([resolves(javac), resolves(java)])
      return javacOk && javaOk
    },

    // Filled in by Task 9. Every earlier Phase B task only needs the shape.
    async run(_req: RunRequest, _signal?: AbortSignal): Promise<RunResult> {
      throw new Error('LocalBackend.run is not implemented yet')
    },
  }
}
