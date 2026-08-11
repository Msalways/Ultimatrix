/**
 * Architecture Evals — Slice 12.
 *
 * Architecture-level evals that drive the SAME runtime APIs the CLI and web
 * surfaces use (SpiderRuntime, EngagementBoundary, WorkflowStore, model
 * routing, worker spawn, proof rules, browser provider) and assert the vertical
 * workflow is coherent — not just that individual units pass.
 *
 * Evals are deterministic and LLM-free: the only fakes are at the model/browser
 * boundary (fake worker agents, no live crawling). Everything else is the real
 * production module, wired the way the runtime wires it.
 */

/** A single architecture eval case. */
export interface ArchitectureEvalCase {
  /** Stable, unique id (also the vitest test name). */
  id: string
  name: string
  /** The workflow input this case is proving (target, config, workflowId, …). */
  workflowInput: unknown
  /** Ordered event names that must appear in the emitted event stream. */
  expectedEvents: string[]
  /** Subset assertions on the final eval state (deep-equal per key). */
  expectedState: Record<string, unknown>
  /** Executes the vertical flow; returns the emitted event names + final state. */
  execute: () => Promise<{ events: string[]; state: Record<string, unknown> }>
}

export interface ArchitectureEvalResult {
  caseId: string
  passed: boolean
  failures: string[]
  durationMs: number
}

export interface ArchitectureEvalSuite {
  name: string
  cases: ArchitectureEvalCase[]
}
