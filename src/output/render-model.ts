/**
 * Shared output model — the single source of truth both terminal and web UIs
 * render from. Platform-agnostic (no Ink / no React imports) so the same stream
 * drives termcn in the CLI and a React reducer in the web UI.
 *
 * The engine emits `SolverStreamMessage` (see solver.ts). This module folds
 * that stream into a `RenderModel` — an incremental, serializable view-model
 * the adapters paint. No formatting, no ANSI, no JSX here.
 */

import type {
  SolverStreamMessage,
  SolverAnswer,
  SolverPhase,
} from '../solver/solver'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface RenderFinding {
  id: string
  severity: Severity
  technique: string
  /** Human-facing title/summary. Structural; filled from the engine's finding shape. */
  title: string
  endpoint?: string
}

export interface RenderToolCall {
  id: number
  name: string
  state: 'start' | 'ok' | 'err'
  args?: Record<string, unknown>
  /** Structured worker output body (compact string form). Undefined until the result arrives. */
  result?: string
}

export interface RenderModel {
  /** Model reasoning (scratch). Append-only delta buffer. */
  reasoning: string
  /** Deliverable answer. Append-only delta buffer. */
  answer: string
  /** Tool-call timeline. */
  tools: RenderToolCall[]
  /** Findings surfaced so far (final answer may re-emit them). */
  findings: RenderFinding[]
  /** Current phase. */
  phase: SolverPhase | null
  /** Final structured answer, present only on `done`. */
  done: SolverAnswer | null
  /** Whether the stream has completed. */
  complete: boolean
  /** Session context (set once by the host; rendered in the status bar). */
  engine?: string
  provider?: string
  target?: string
  /** Bounds / progress for the step counter. */
  step: number
  maxSteps?: number
  /** Outcome goal label, surfaced in the footer. */
  goal?: string
}

let _toolSeq = 0

export function createRenderModel(): RenderModel {
  return {
    reasoning: '',
    answer: '',
    tools: [],
    findings: [],
    phase: null,
    done: null,
    complete: false,
    step: 0,
  }
}

function toSeverity(s: string): Severity {
  switch (s.toLowerCase()) {
    case 'critical': return 'critical'
    case 'high': return 'high'
    case 'medium': return 'medium'
    case 'low': return 'low'
    default: return 'info'
  }
}

/**
 * Fold one `SolverStreamMessage` into the model (mutating a copy, returning it).
 * Pure w.r.t. the message contract; callers own the model instance.
 */
/**
 * Fold a `reasoning`/`answer` delta into the buffer, normalizing the two
 * streaming shapes providers use, structurally (no provider-name branching):
 *
 *  1. INCREMENTAL (OpenAI/Anthropic): chunk N is a new suffix → append.
 *  2. CUMULATIVE (nvidia/llama-style): chunk N is the FULL text-so-far, advanced
 *     by a few chars (prefix of the next chunk). Appending each would duplicate
 *     the text N× — so a cumulative chunk SUPERSEDES the buffer.
 *
 * Rules (all based on string-prefix/suffix relationships, never on model names):
 *  - delta === current              → exact full repeat, no new info → skip.
 *  - delta.startsWith(current)      → cumulative advance → return delta (supersede).
 *  - current.endsWith(delta)        → delta is a redundant tail of current → skip.
 *  - otherwise                      → true incremental suffix → append.
 */
export function appendDelta(current: string, delta: string): string {
  if (delta === current) return current
  if (delta.startsWith(current)) return delta
  if (current.endsWith(delta)) return current
  return current + delta
}

export function reduceMessage(model: RenderModel, msg: SolverStreamMessage): RenderModel {
  switch (msg.kind) {
    case 'reasoning':
      model.reasoning = appendDelta(model.reasoning, msg.text)
      break
    case 'answer':
      model.answer = appendDelta(model.answer, msg.text)
      break
    case 'tool':
      _toolSeq += 1
      model.tools.push({ id: _toolSeq, name: msg.name, state: 'start', args: msg.args })
      break
    case 'tool-result': {
      const last = [...model.tools].reverse().find(t => t.name === msg.name && t.state === 'start')
      if (last) {
        last.state = msg.ok ? 'ok' : 'err'
        if (typeof msg.result === 'string') last.result = msg.result
      } else {
        model.tools.push({ id: ++_toolSeq, name: msg.name, state: msg.ok ? 'ok' : 'err', result: typeof msg.result === 'string' ? msg.result : undefined })
      }
      break
    }
    case 'phase':
      model.phase = msg.phase
      if (typeof msg.step === 'number') model.step = msg.step
      break
    case 'done':
      model.done = msg.answer
      model.complete = true
      if (typeof msg.answer.steps === 'number') model.step = msg.answer.steps
      if (typeof msg.answer.toolCalls === 'number') model.maxSteps = msg.answer.toolCalls
      if (msg.answer.findings?.length) {
        model.findings = msg.answer.findings.map(f => ({
          id: f.id,
          severity: toSeverity(f.severity),
          technique: f.technique,
          title: f.technique || f.id,
          endpoint: f.endpoint,
        }))
      }
      // The final answer content supersedes any partial deltas.
      if (msg.answer.content) model.answer = msg.answer.content
      if (msg.answer.reasoning) model.reasoning = msg.answer.reasoning
      break
  }
  return model
}

/** Convenience: fold a full array of messages into a fresh model. */
export function buildRenderModel(messages: SolverStreamMessage[]): RenderModel {
  const m = createRenderModel()
  for (const msg of messages) reduceMessage(m, msg)
  return m
}

/**
 * Compact, shape-only summary of tool args for the WORKER LOG drawer.
 * Reads structural fields (method/url/endpoint/query) by KEY — never enumerates
 * a value universe, so it stays vocabulary-free. Unknown shapes fall back to a
 * short JSON preview. No regex, no keyword scanning.
 */
export function argsSummary(args: Record<string, unknown> | undefined, max = 60): string {
  if (!args || typeof args !== 'object') return ''
  const parts: string[] = []
  const push = (s: string) => { if (s) parts.push(s) }
  if (typeof args.method === 'string') push(args.method.toUpperCase())
  if (typeof args.url === 'string') push(String(args.url))
  else if (typeof args.endpoint === 'string') push(String(args.endpoint))
  else if (typeof args.query === 'string') push(String(args.query))
  if (typeof args.severity === 'string') push(`sev:${args.severity}`)
  if (typeof args.technique === 'string') push(String(args.technique))
  let out = parts.join(' ')
  if (!out) {
    const json = JSON.stringify(args)
    out = json.length > max ? json.slice(0, max) + '…' : json
  }
  return out.slice(0, max)
}

/**
 * Compact one-line summary of a worker result for the WORKER OUTPUT drawer.
 * Shape-only: reports byte length + first top-level key if present. Never
 * pretty-prints the whole body (keeps the screen clean); full body is available
 * via the structured `result` field on demand.
 */
export function resultSummary(result: string | undefined, max = 80): string {
  if (!result) return ''
  let preview = result.replace(/\s+/g, ' ').trim()
  if (preview.length > max) preview = preview.slice(0, max) + '…'
  return preview
}
