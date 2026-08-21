import { execFileSync } from 'node:child_process'
import { it } from 'vitest'

// Long enough for a slow-starting JVM on a loaded machine, short enough that
// a hung binary does not stall test collection.
const PROBE_TIMEOUT_MS = 5_000

/**
 * Independently checks whether `bin` resolves, by asking it for its version.
 *
 * Deliberately does not call `local.ts`'s `resolves()` (or
 * `createLocalBackend().available()`) — this probe exists specifically so a
 * defect in `available()`'s own implementation cannot make the gate agree
 * with the thing it is meant to be gating. If `available()` were broken to
 * always return `false`, this probe must still correctly report that a JDK
 * is present, so the test asserting `available()` returns `true` still runs
 * (and then fails for the real reason, not a masked one).
 *
 * Synchronous, not async like `local.ts`'s probe, so callers can gate at
 * `describe`/`it` registration time — module top-level code that decides
 * which tests to register must run synchronously in Vitest, the same
 * constraint `packages/store/src/postgres.test.ts` works under for
 * `TEST_DATABASE_URL`.
 */
function resolvesSync(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { timeout: PROBE_TIMEOUT_MS, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let cached: boolean | undefined

/**
 * True when both `javac` and `java` resolve on PATH. Cheap: spawns each
 * binary once with `-version` and never compiles or runs anything. Cached
 * for the lifetime of the process — a test file that gates many `it` blocks
 * with this does one pair of spawns, not one pair per test.
 */
export function hasJdk(): boolean {
  if (cached === undefined) cached = resolvesSync('javac') && resolvesSync('java')
  return cached
}

export const JDK_MISSING_REASON = 'skipped: no JDK on PATH (javac/java did not resolve)'

/**
 * Registers a test that needs a real `javac`/`java` on PATH — compiling,
 * running, or anything that shells out to the actual toolchain rather than
 * exercising a substituted binary name.
 *
 * When no JDK is present this registers `it.skip` with a name carrying
 * `JDK_MISSING_REASON`, so a run without a JDK reports a visible, named skip
 * (matching `packages/store/src/postgres.test.ts`'s `TEST_DATABASE_URL`
 * gate) instead of a red suite or a silently empty describe block.
 *
 * Only wrap tests that actually require the toolchain. A test like
 * `available()` returning `false` for a binary name that cannot exist on
 * any machine needs no JDK and must run unconditionally — do not wrap it.
 */
export function itWithJdk(name: string, fn: () => void | Promise<void>): void {
  if (hasJdk()) {
    it(name, fn)
  } else {
    it.skip(`${JDK_MISSING_REASON} — ${name}`, () => {})
  }
}
