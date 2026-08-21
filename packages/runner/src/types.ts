export type RunLimits = { wallClockMs: number; outputBytes: number }

export type RunRequest = {
  language: 'java' | 'cpp'
  files: { path: string; content: string }[]
  entryPoint: string
  stdin?: string
  limits: RunLimits
}

export type Diagnostic = {
  file: string
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
}

export type RunResult = {
  phase: 'compile' | 'run'
  exitCode: number | null
  stdout: string
  stderr: string
  /**
   * Total elapsed time for the whole Run request — compile phase plus run
   * phase — not the duration of whichever phase this result's `phase` names.
   * The user presses Run once; a caller that spreads a single sub-phase's
   * timing (e.g. only the `run` supervise() call) into this field would
   * silently under-report by the compile time. Per-phase timings can be
   * added separately later if ever needed; this field is always the total.
   */
  durationMs: number
  timedOut: boolean
  truncated: boolean
  cancelled: boolean
  diagnostics: Diagnostic[]
}

export interface RunnerBackend {
  available(): Promise<boolean>
  run(req: RunRequest, signal?: AbortSignal): Promise<RunResult>
}

export const DEFAULT_LIMITS: RunLimits = { wallClockMs: 10_000, outputBytes: 262_144 }
