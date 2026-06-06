// src/hunt/types.ts
//
// HuntCore state types. The continuous-loop orchestrator holds one
// `HuntState` and emits `HuntEvent`s to subscribed frontends. State
// is mutated in-place; events are the public API for reading.

/** What stopped the hunt. */
export type TerminationReason =
  | 'time-budget'    // wall-clock budget exhausted
  | 'llm-exhausted'  // meta-orchestrator LLM decided surface is done
  | 'user-quit'      // user typed /quit or hit Ctrl+C
  | 'budget-spent'   // dollar budget exhausted
  | 'error';         // unrecoverable error

/** Top-level hunt state. */
export interface HuntState {
  /** The target URL the user is hunting. */
  target: string;
  /** When the hunt started (epoch ms). */
  startedAt: number;
  /** When the hunt ended (epoch ms) or null if still running. */
  endedAt: number | null;
  /** Termination reason if ended. */
  terminationReason: TerminationReason | null;

  /** Wall-clock budget in seconds. */
  maxRuntimeSeconds: number;
  /** Dollar budget. */
  maxDollars: number;
  /** Dollars spent so far. */
  dollarsSpent: number;

  /** Phase the hunt is in. With continuous-loop, this is informational. */
  phase: HuntPhase;

  /** IDs of agents currently alive. */
  activeAgentIds: Set<string>;

  /** Findings emitted so far. */
  findings: import('../core/app-model').AppModelFinding[];

  /** Behavioral steps captured so far. */
  behavioralStepCount: number;

  /** Number of primitive calls made. */
  primitiveCallCount: number;

  /** Number of OOB callbacks received. */
  oobCallbackCount: number;

  /** Number of screenshots saved. */
  screenshotCount: number;
}

export type HuntPhase = 'starting' | 'observing' | 'attacking' | 'analyzing' | 'done';

/** Summary returned when the hunt ends. */
export interface HuntSummary {
  durationMs: number;
  totalSteps: number;
  totalPrimitiveCalls: number;
  findingsCount: number;
  findingsBySeverity: Record<string, number>;
  findingsByType: Record<string, number>;
  oobCallbacks: number;
  screenshots: number;
  cost: number;
}
