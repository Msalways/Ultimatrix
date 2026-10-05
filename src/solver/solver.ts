/**
 * Organic Solver Engine — Agent-driven security exploration
 *
 * Single agent.stream() call per REPL turn. The LLM drives everything:
 * what tools to call, in what order, when to stop. Mastra handles the
 * tool-call → tool-result → reasoning cycle internally via maxSteps.
 *
 * Intelligence layers (EvidenceGate, Reflexion, LoopDetector) observe
 * passively — they record state but do NOT gate or interrupt the agent.
 *
 * The agent starts cold with catalog discovery and exact capability loading.
 * No semantic routing or workflow prompt is added here.
 */

import type { Agent } from "@mastra/core/agent";
import { Blackboard } from "./blackboard";
import { EvidenceGate } from "../intelligence/evidence-gate";
import { ReflexionEngine } from "../intelligence/reflexion";
import { LoopDetector, extractAttackPath } from "../intelligence/anti-loop";
import { log } from "../utils/logger";
import { getForensicLog } from "../tools/report-tools";
import { saveReflexionState } from "../intelligence/reflexion-store";
import { getGlobalGraphStore } from "../graph/store";
import { NodeType } from "../graph/schema";
import { DEFAULTS, type UltimatrixConfig } from "../config";
import { getGlobalUsageTracker } from "../usage/tracker";
import { ContextBudgetManager } from "../models/context-manager";
import { ContextWindowRegistry } from "../models/context-window-registry";
import { planAdaptiveContext, compressBrainInstructions, filterToolsToBudget, type AdaptivePlan } from "../models/adaptive-context";
import { resolveModelRef } from "../models/routing";
import { getGlobalQuotaTracker } from "../models/quota-tracker";
import { appendDelta, visibleAssistantText } from "../output/render-model";
import { buildRuntimeEnvelope, type RuntimeAlert } from "../runtime/context-envelope";
import { getEngagementServices } from "../runtime/engagement-context";
import { setInteractionMode } from "../tools/interaction-tools";
import { getCapturedRequestStore } from "../capture/captured-request-store";
import { CrossEngagementMemory } from "../intelligence/cross-engagement";
import { buildBudgetedGoal, type GoalSection } from "./budgeted-goal";
import { buildDoneIndex } from "./done-index";
import type { WorkflowStore } from "../workflow/store";
import type { DynamicToolRegistry } from "../extensions/tool-registry";
import type { LazySolverServices } from "../runtime/lazy-services";
import { buildResearchMap, planResearchExperiments } from "../tools/research-tools";
import { actionLimitBootstrapFacts, plannedResearchBootstrapFacts } from './research-context';
import { useCredential } from "../tools/credential-tools";
import { discoverSkillsForTarget, loadSkillBodyTool } from "../tools/skill-tools";
import { resolveProgressTimeoutMs } from "./model-fallback";
import type { CampaignResult } from "../campaign/types";
import { buildAssessmentReport, type AssessmentReport } from "./assessment-report";
import { hasObservedWorkflowSequence } from '../research/types';

// Backward-compatible model→context mapping for models not in ModelCapabilities config
/**
 * Truncate enriched goal to fit within model context budget.
 * Preserves user's original goal. Trims injected context from least to most important.
 */
/**
 * Structured solver output contract.
 *
 * The streaming layer previously overloaded a single `text` field with both
 * transient reasoning (thinking) and the deliverable answer, and never awaited
 * the `stream.text` promise. On reasoning-capable models the final answer was
 * intermittently lost. This contract separates the two concerns with typed,
 * ordered, serializable messages — robust to model channel ordering and clean
 * to render in a future Web UI (reasoning panel, answer stream, tool timeline,
 * final answer card). Mirrors the council output-contract discipline: structured
 * typed fields at all seams, no substring detection.
 */

/** Transient model reasoning (scratch). Never the deliverable. */
export interface SolverReasoningDelta {
  text: string;
  index: number;
}

/** Deliverable answer delta. The agent's message. */
export interface SolverAnswerDelta {
  text: string;
  index: number;
}
/** Structured final result — the single source of truth the UI binds to. */
export interface SolverAnswer {
  content: string;
  reasoning: string;
  findings: Array<{
    id: string;
    severity: string;
    technique: string;
    endpoint?: string;
  }>;
  /**
   * Findings recorded in the ledger during THIS turn, excluding persisted
   * findings. The card uses this turn-scoped count (not the graph-wide
   * findings list) to state whether the turn proved anything — prose
   * verdicts without a recorded entry here are unproven by construction.
   */
  newFindings: number;
  planSummary?: string;
  status: SolveResult["reason"];
  completed: boolean;
  assessmentStatus?: 'complete' | 'partial';
  assessmentReport?: AssessmentReport;
  campaign?: CampaignResult;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  steps: number;
  toolCalls: number;
}

/**
 * Streaming message emitted via `onPhase`. Discriminated union keyed by `kind`.
 * Replaces the ambiguous `PhaseEvent.text + reasoning` shape.
 *
 * Tool/tool-result variants carry optional worker context fields so the UI
 * can attribute tool calls to specific swarm workers.
 */
export type SolverStreamMessage =
  | { kind: "reasoning"; text: string; index: number }
  | { kind: "answer"; text: string; index: number }
  | { kind: "tool"; name: string; args?: Record<string, unknown>; workerId?: string; workerName?: string; toolCallId?: string }
  | { kind: "tool-result"; name: string; ok: boolean; result?: string; workerId?: string; workerName?: string; toolCallId?: string }
  | { kind: "phase"; phase: SolverPhase; step: number }
  | { kind: "event"; event: string; label: string; status?: "info" | "running" | "ok" | "warn" | "error"; data?: Record<string, unknown> }
  | { kind: "done"; answer: SolverAnswer };

export interface SolverConfig {
  maxToolCalls?: number;
  maxDurationMs?: number;
  staleThreshold?: number;
  maxParallel?: number;
  /**
   * Inter-chunk stream watchdog budget in ms. Positive values are honored
   * (floored at 15s); 0/undefined auto-scales with `maxDurationMs`
   * (see `resolveProgressTimeoutMs`). Slow reasoning providers legitimately
   * pause between chunks — this must tolerate that without killing the turn.
   */
  progressTimeoutMs?: number;
}

export type SolverPhase =
  | "observe"
  | "learn"
  | "attack"
  | "record"
  | "reason"
  | "complete"
  | "stale"
  | "interrupt";

export interface PhaseEvent {
  phase: SolverPhase;
  step: number;
  text?: string;
  /** True when `text` is model reasoning/thinking (not the final answer). */
  reasoning?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  reason?: string;
  /** Non-behavioral descriptor metadata for UI and forensic display. */
  activity?: string;
  progress?: {
    endpoints: number;
    findings: number;
    tested: number;
    pending: number;
  };
  interruptPrompt?: string;
  /** Worker context — present when the event originates from a spawned worker. */
  workerId?: string;
  workerName?: string;
  workerSkill?: string;
}

export interface SolveResult {
  interactionMode?: "ask" | "run";
  completed: boolean;
  reason:
    | "goal_achieved"
    | "response_complete"
    | "grounding_failed"
    | "context_blocked"
    | "frontier_exhausted"
    | "budget_reached"
    | "stale"
    | "interrupted"
    | "model_failed"
    | "tool_unavailable"
    | "browser_failed"
    | "tool_failed";
  steps: number;
  toolCalls: number;
  /** Findings added during this turn, excluding persisted findings. */
  newFindings: number;
  tokensUsed: number;
  durationMs: number;
  facts: number;
  intents: number;
  planSummary?: string;
  /** @deprecated Use `answer.content`. Retained for back-compat; mirrors it. */
  text?: string;
  /** Structured final answer — the UI-facing source of truth. */
  answer?: SolverAnswer;
  error?: string;
  assessmentStatus?: 'complete' | 'partial';
  assessmentReport?: AssessmentReport;
  campaign?: CampaignResult;
  campaignError?: string;
}

export interface SolveParams {
  origin: string;
  goal: string;
  interactionMode?: "ask" | "run";
  /** Correlates operator replies and steering with one live shared-engine run. */
  interactionRunId?: string;
  hints?: string[];
  model?: string;
  config?: SolverConfig;
  ultimatrixConfig?: UltimatrixConfig;
  blackboard?: Blackboard;
  evidence?: EvidenceGate;
  loopDetector?: LoopDetector;
  reflexion?: ReflexionEngine;
  memory?: { thread: string; resource: string };
  signal?: AbortSignal;
  onPhase?: (event: PhaseEvent) => void;
  /** Structured streaming output (preferred). Falls back to `onPhase` adapter if absent. */
  onMessage?: (message: SolverStreamMessage) => void;
  onToolComplete?: (toolName: string, result?: unknown) => void;
  modelCapabilities?: import("../config").ModelCapabilities;
  budgetPolicy?: import("../config").BudgetPolicy;
  workflow?: WorkflowStore;
  /**
   * Cross-engagement priors prompt block. When absent, the solver loads it
   * from the anonymized cross-engagement memory (no-op when empty/unavailable).
   */
  priorsPromptBlock?: string;
  /** Target-scoped services used for autonomous observation before reasoning. */
  lazyServices?: LazySolverServices;
  /**
   * Turn-level findings baseline for multi-attempt turns. A retry is a new
   * solve() call, so its private snapshot would already include findings
   * recorded by the failed attempt — and the turn would report newFindings
   * 0 despite proving something. The caller takes this once per user turn
   * (before attempt 1) and passes it to every attempt; the delta floors at
   * the minimum of both snapshots. Absent = single-attempt behavior.
   */
  turnStartFindings?: number;
}

const SOLVER_DEFAULTS: Required<SolverConfig> = {
  maxToolCalls: DEFAULTS.solver.maxToolCalls,
  maxDurationMs: DEFAULTS.solver.maxDurationMs,
  staleThreshold: DEFAULTS.antiLoop.staleThreshold,
  maxParallel: DEFAULTS.solver.maxParallel,
  progressTimeoutMs: 0,
};

function extractVulnType(
  args: Record<string, unknown> | undefined,
): string {
  return String(args?.technique ?? args?.vulnType ?? args?.primitiveId ?? args?.primitive ?? "");
}

interface CompletionResult {
  completed: boolean;
  reason: SolveResult["reason"];
}

/** Bound provider stalls between stream chunks so deterministic research can
 * hand back a partial, honest result instead of hanging the whole turn. */
export async function* withProgressWatchdog<T>(
  source: AsyncIterable<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]()
  let pendingToolCalls = 0
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      const nextPromise = iterator.next()
      const races: Array<Promise<IteratorResult<T>>> = [nextPromise]
      // Tool execution is part of the model stream, but a long browser/HTTP
      // call is not a stalled model. The turn-level abort signal still bounds
      // the operation while its result is pending.
      if (pendingToolCalls === 0) {
        races.push(new Promise<IteratorResult<T>>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Model progress watchdog expired after ${timeoutMs}ms`)), timeoutMs)
        }))
      }
      if (signal) {
        races.push(new Promise<IteratorResult<T>>((_, reject) => {
          onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Solver aborted'))
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }))
      }
      const next = await Promise.race(races)
      if (next.done) return
      const event = next.value as { type?: unknown }
      if (event.type === 'tool-call') pendingToolCalls++
      else if (event.type === 'tool-result' || event.type === 'tool-error' || event.type === 'tool-output-error') {
        pendingToolCalls = Math.max(0, pendingToolCalls - 1)
      }
      yield next.value
    } catch (error) {
      // Do not wait for a tool-backed iterator to finish after the hard turn
      // deadline. Its stream has the same abort signal; returning control here
      // keeps a slow browser/model operation from extending the run budget.
      try { void Promise.resolve(iterator.return?.()).catch(() => {}) } catch { /* best-effort cancellation */ }
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    }
  }
}

// ─── Recent Discoveries (per-turn graph diff) ───────────────

function withPromiseTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const races: Array<Promise<T>> = [
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ]
  if (signal) {
    races.push(new Promise<T>((_, reject) => {
      onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Solver aborted'))
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }))
  }
  return Promise.race(races).finally(() => {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  })
}

interface DiscoverySnapshot {
  endpoints: Set<string>;
  findings: Set<string>;
}
const recentDiscoveryMemory = new Map<string, DiscoverySnapshot>();

/**
 * Diff the current graph against this origin's last-turn snapshot. Returns a
 * Recent Discoveries block for the enriched goal (empty on the baseline turn
 * or when nothing changed). Structural diff only — no keyword logic.
 */
function buildRecentDiscoveries(origin: string): string {
  try {
    const store = getGlobalGraphStore();
    const endpoints = (store.queryNodes?.(NodeType.ENDPOINT) ?? []) as Array<{
      id: string;
      properties: { url?: string; method?: string };
    }>;
    const findings = (store.queryNodes?.(NodeType.FINDING) ?? []) as Array<{
      id: string;
      properties: { technique?: string; endpoint?: string; severity?: string; findingId?: string };
    }>;

    const endpointKeys = endpoints.map((e) => `${String(e.properties.method ?? "GET").toUpperCase()}:${String(e.properties.url ?? e.id)}`);
    const findingIds = findings.map((f) => String(f.properties.findingId ?? f.id));
    const prev = recentDiscoveryMemory.get(origin);
    recentDiscoveryMemory.set(origin, { endpoints: new Set(endpointKeys), findings: new Set(findingIds) });

    if (!prev) return "";

    const newEndpoints = endpoints.filter((_e, i) => !prev.endpoints.has(endpointKeys[i]));
    const newFindings = findings.filter((f, i) => !prev.findings.has(findingIds[i]));
    if (newEndpoints.length === 0 && newFindings.length === 0) return "";

    const lines: string[] = ["## Recent Discoveries"];
    if (newEndpoints.length > 0) lines.push(`New endpoints: ${newEndpoints.length}`);
    if (newFindings.length > 0) {
      lines.push(`New findings: ${newFindings.length}`);
      for (const f of newFindings.slice(0, 5)) {
        const technique = String(f.properties.technique ?? "unknown");
        const endpoint = String(f.properties.endpoint ?? "");
        const severity = String(f.properties.severity ?? "").toUpperCase();
        lines.push(`- ${technique}${endpoint ? ` on ${endpoint}` : ""}${severity ? ` (${severity})` : ""}`);
      }
      if (newFindings.length > 5) lines.push(`(+${newFindings.length - 5} more)`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

/**
 * Load the cross-engagement priors prompt block. Read-only against the
 * anonymized global memory (content was policy-gated at write time); empty
 * when no prior engagements exist or the store is unavailable.
 */
async function loadPriorsBlock(): Promise<string | undefined> {
  try {
    const mem = new CrossEngagementMemory();
    await mem.load();
    if (mem.getEngagementCount() === 0) return undefined;
    const priors = mem.getPriorPatterns();
    return priors.promptBlock || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine completion based on graph findings and conversation state.
 *
 * Classification is based on observed execution, not prompt wording:
 * - New graph findings exist -> goal_achieved
 * - A response with no tool calls -> response_complete
 * - Tool calls with no new findings -> frontier_exhausted
 * - Nothing happened -> stale
 */
function checkCompletion(
  toolCallCount: number,
  bodyText: string,
  reasoningText: string,
  newFindings: number,
): CompletionResult {
  // Nothing user-visible happened. Reasoning-only output is not a valid turn.
  if (toolCallCount === 0 && bodyText.length === 0) {
    return { completed: false, reason: "stale" };
  }

  // A response-only turn is complete, but it is not an assessment run.
  if (toolCallCount === 0 && bodyText.length > 0) {
    return { completed: false, reason: "response_complete" };
  }

  if (newFindings > 0) {
    return { completed: true, reason: "goal_achieved" };
  }

  // Agent responded but no findings — normal turn
  return { completed: false, reason: "frontier_exhausted" };
}

async function getNextStepTools(agent: Agent, capabilityRegistry?: DynamicToolRegistry): Promise<Record<string, any>> {
  const turnToolset = (agent as any).getTurnToolset;
  if (typeof turnToolset === "function") return await turnToolset();
  const configuredTools = (agent as any).tools;
  if (typeof configuredTools === "function") return await configuredTools();
  if (configuredTools && typeof configuredTools === "object") return configuredTools;
  return capabilityRegistry?.getActiveToolset() ?? {};
}

async function stringifyToolSchemas(tools: Record<string, any>): Promise<string> {
  return JSON.stringify(Object.fromEntries(
    Object.entries(tools).map(([id, tool]) => [id, tool?.inputSchema ?? null]),
  ));
}




/**
 * Solve — single agent.stream() call per REPL turn.
 *
 * The agent starts with catalog discovery only. Activated native tools are
 * refreshed between model steps. Goal is the user message plus a bounded
 * deterministic runtime index.
 */
/**
 * Normalize an error chunk from the model stream into a message worth showing.
 *
 * The payload shape varies by provider and by AI SDK version, so this reads the
 * fields that actually carry information rather than assuming one shape. A
 * provider 503 arrives as an Error object nested in a plain record; stringifying
 * it blindly yields "[object Object]" and the operator is told nothing.
 */
export function describeStreamError(payload: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  // Values that carry no information. "type: 'error'" is true of every failure
  // ever reported, so surfacing it just makes the operator read "… | error".
  const UNINFORMATIVE = new Set(['error', 'unknown', 'undefined', 'null', 'failed', 'failure']);
  const visit = (value: unknown, depth: number): void => {
    if (value === null || value === undefined || depth > 4) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (typeof value === 'string') {
      const text = value.trim();
      if (text && !UNINFORMATIVE.has(text.toLowerCase())) parts.push(text);
      return;
    }
    if (typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (value instanceof Error) {
      if (value.message) visit(value.message, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of ['message', 'error', 'type', 'code', 'statusCode', 'reason']) {
        if (key in record) visit(record[key], depth + 1);
      }
    }
  };
  visit(payload, 0);
  const text = [...new Set(parts)].filter(Boolean).join(' | ');
  return text || 'unknown model stream error';
}

export interface ModelFailureClassification {
  /** Terminal reason to record, when the failure invalidates the turn. */
  reason?: 'model_failed';
  /** Operator-facing message: what broke, and what to do about it. */
  message: string;
}

/**
 * Turn a model/provider failure into an actionable operator-facing message.
 *
 * Shared by the throw path and the stream-error path. These were previously one
 * inline chain reachable only from `catch`, which is precisely why a provider
 * 503 delivered as a stream event produced no explanation at all: it never
 * reached the classifier. One implementation, two entry points, so the two can
 * never drift into telling the operator different things about the same outage.
 */
export function classifyModelFailure(
  errMsg: string,
  ctx: { interrupted?: boolean; timedOut?: boolean; timeoutMs?: number; existingReason?: string } = {},
): ModelFailureClassification {
  const lowerMsg = errMsg.toLowerCase();
  if (ctx.interrupted) return { message: 'Solver interrupted by user.' };
  if (ctx.timedOut) {
    return { message: `Solver timed out after ${ctx.timeoutMs}ms. Increase solver.maxDurationMs in config.` };
  }
  if (
    lowerMsg.includes('cannot connect') ||
    lowerMsg.includes('headers timeout') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('socket hang up') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('network')
  ) {
    // Transport death outranks any earlier non-fatal classification (e.g. a
    // single failed browser probe setting browser_failed): the provider is
    // unreachable, so the turn is failover-eligible, not dead. The earlier state
    // stays visible in forensic + the message.
    return {
      reason: 'model_failed',
      message: `Model transport failed: ${errMsg}. Partial research state was preserved; retry or switch model/provider.`,
    };
  }
  if (ctx.existingReason) return { message: `${ctx.existingReason}: ${errMsg}` };
  if (
    errMsg.includes('401') || errMsg.includes('403')
    || lowerMsg.includes('forbidden') || lowerMsg.includes('unauthorized')
    || lowerMsg.includes('authentication failed') || lowerMsg.includes('invalid api key')
  ) {
    // Terminal and specific: the same dead credential fails identically on every
    // model behind that provider, so escalating the tier ladder cannot help.
    // Telling the operator "Solver error" here wastes their time guessing; the
    // credential is the whole problem.
    return {
      reason: 'model_failed',
      message: `Model credential rejected: ${errMsg}. Nothing was changed and retrying will not help — fix the key for this provider (ultimatrix init, or the providers file) and start a new turn.`,
    };
  }
  if (errMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('quota exhausted')) {
    return {
      reason: 'model_failed',
      message: `Model rate limited or quota exhausted: ${errMsg}. Try switching provider/model in config.`,
    };
  }
  if (errMsg.includes('503') || lowerMsg.includes('service_unavailable') || lowerMsg.includes('temporarily overloaded') || lowerMsg.includes('overloaded')) {
    return {
      reason: 'model_failed',
      message: `Model service unavailable: ${errMsg}. Nothing was changed. Retry, or switch provider/model in config.`,
    };
  }
  if (errMsg.includes('Model progress watchdog')) {
    return {
      reason: 'model_failed',
      message: `Model progress stalled: ${errMsg}. Partial research state was preserved; retry or switch model/provider.`,
    };
  }
  if (lowerMsg.includes('timeout')) {
    return { message: `Solver timed out: ${errMsg}. Increase solver.maxDurationMs in config.` };
  }
  return {
    reason: 'model_failed',
    message: `Solver error: ${errMsg}`,
  };
}

export async function solve(
  agent: Agent,
  params: SolveParams,
): Promise<SolveResult> {
  const cfg = { ...SOLVER_DEFAULTS, ...params.config };
  const board =
    params.blackboard ||
    new Blackboard({ origin: params.origin, goal: params.goal });
  const evidence = params.evidence || new EvidenceGate();
  const loopDetector = params.loopDetector || new LoopDetector();
  const reflexion = params.reflexion || new ReflexionEngine();
  const forensicLog = getForensicLog();
  let campaignResult: CampaignResult | undefined;
  let campaignError: string | undefined;

  // Wire EvidenceGate into writeFinding for Maker/Checker split
  const { setEvidenceGateForFindings } = await import("../tools/control-tools");
  setEvidenceGateForFindings(evidence);
  // Establish the approval boundary before deterministic research bootstrap.
  // Safe GET experiments may run during observation; mutations require the
  // explicit run-mode decision and are checked again inside the research tool.
  setInteractionMode(params.interactionMode);

  // G1: Load persisted outcome feedback from prior sessions into the
  // in-memory store so technique weights are restored at session start.
  // This closes the learning loop: outcomes saved to graph at engagement
  // end are loaded back into the registry at next session start.
  try {
    const { loadOutcomeFeedback } = await import("../intelligence/reflexion-store");
    const { getOutcomeFeedbackStore } = await import("../intelligence/outcome-feedback");
    const persisted = loadOutcomeFeedback(params.origin);
    if (persisted.length > 0) {
      const store = getOutcomeFeedbackStore();
      store.ingestAll(persisted);
    }
  } catch { /* outcome feedback not available */ }

  // G4: Load persisted technique weights from prior sessions.
  // Weights survive process restart — the registry starts with whatever
  // the last engagement learned about technique effectiveness.
  try {
    const { loadTechniqueWeights } = await import("../intelligence/reflexion-store");
    const loaded = await loadTechniqueWeights();
    if (loaded > 0) {
      log.dim(`[evolution] Restored ${loaded} technique weights from prior sessions`);
    }
  } catch { /* weight loading not available */ }

  const emit = (event: PhaseEvent) => params.onPhase?.(event);
  const emitMessage = (message: SolverStreamMessage) => params.onMessage?.(message);
  const startTime = Date.now();
  const timeoutSignal = AbortSignal.timeout(cfg.maxDurationMs);
  const streamSignal = params.signal
    ? AbortSignal.any([params.signal, timeoutSignal])
    : timeoutSignal;

  // Seed blackboard (only if fresh)
  if (board.facts.length === 0) {
    board.addFact(
      `Target origin=${params.origin}; goal=${params.goal}`,
      "origin",
    );
    if (params.hints) {
      for (const h of params.hints) {
        board.addFact(`Hint: ${h}`, "hint");
      }
    }
    // F19 FIX: Load reflexion hints from prior sessions/failures.
    // This closes the learning loop — the brain can now consume prior-session
    // knowledge about what worked and what failed.
    try {
      const { loadRelevantHints } = await import("../intelligence/reflexion-store");
      const priorHints = loadRelevantHints("", params.origin);
      if (priorHints.length > 0) {
        for (const h of priorHints) {
          board.addFact(`Prior learning: ${h}`, "reflexion-hint");
        }
      }
    } catch {
      // Reflexion store not available
    }
  }

  const capabilityRegistry = (agent as any).capabilityRegistry as DynamicToolRegistry | undefined;
  // Autonomous observation is a runtime responsibility, not an LLM decision.
  // LazySolverServices.crawl() owns browser startup, HAR/passive capture,
  // graph ingestion, and post-crawl discovery; invoke it once before the
  // first reasoning turn when this is a real engagement agent.
  const lazyServices = params.lazyServices ?? (agent as any).lazyServices as {
    observe?: () => Promise<{ requests: number; url: string }>;
    observationState?: { status: 'completed' | 'failed'; result?: { requests: number; url: string }; error?: string };
    researchBootstrapState?: 'pending' | 'attempted' | 'completed';
    markResearchBootstrapAttempted?: () => void;
    markResearchBootstrapCompleted?: () => void;
    crawl?: () => Promise<unknown>;
    crawlState?: unknown;
    taskStates?: ReadonlyArray<{ taskId: string; status: string }>;
    runCoverageCampaign?: (gate: EvidenceGate) => Promise<CampaignResult>;
    /** Stop a detached crawl (implemented by LazySolverServices). */
    abortCrawl?: (reason?: string) => void;
  } | undefined;
  const observationWasAttempted = Boolean(lazyServices?.observationState)
  if (lazyServices?.observe && !observationWasAttempted && !lazyServices.crawlState) {
    log.info('[observation] starting deterministic browser/HAR baseline');
    emit({ phase: "observe", step: 0, activity: "autonomous-observation" });
    emitMessage({ kind: "event", event: "observation.started", label: "observing target surface", status: "running" });
    try {
      const observed = await withPromiseTimeout(
        lazyServices.observe(),
        cfg.maxDurationMs,
        "Target observation",
        streamSignal,
      );
      board.addFact(
        `Autonomous observation completed: ${observed.requests} captured requests at ${observed.url}; use captured browser traffic and discovered endpoints as evidence.`,
        "observation",
      );
      emitMessage({ kind: "event", event: "observation.completed", label: "target surface observed", status: "ok" });
      log.info(`[observation] captured ${observed.requests} requests from ${observed.url}`);
      // Recon/spider crawling is part of observation, not exploitation. Run it
      // before handing control to the brain so the first hypothesis is based
      // on the discovered surface rather than guessed paths.
      if (lazyServices.crawl && !lazyServices.crawlState && params.ultimatrixConfig?.spider?.enabled !== false) {
        emitMessage({ kind: "event", event: "recon.started", label: "mapping links, forms, and workflows", status: "running" });
        try {
          const crawlTimeoutMs = Math.min(45_000, Math.max(5_000, params.config?.maxDurationMs ? Math.floor(params.config.maxDurationMs * 0.15) : 45_000));
          const spider = await withPromiseTimeout(
            lazyServices.crawl(),
            crawlTimeoutMs,
            "Recon crawl",
            streamSignal,
          );
          const spiderState = spider && typeof spider === "object" ? spider as Record<string, unknown> : undefined;
          board.addFact(`Recon crawl completed${spiderState?.pagesSeen ? `: ${String(spiderState.pagesSeen)} pages seen` : ""}; use the discovered surface for attack selection.`, "recon");
          emitMessage({ kind: "event", event: "recon.completed", label: "target surface mapped", status: "ok" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // The timed-out race must not leave the spider roaming: abort the
          // detached run so it stops driving target traffic immediately.
          // Partial HAR/scripts already captured stay available via the
          // post-crawl fallback below.
          try { lazyServices.abortCrawl?.('Recon crawl timeout') } catch { /* abort is best-effort */ }
          board.addFact(`Recon crawl failed: ${message}. Retain baseline HAR and use observed endpoints for fallback.`, "recon-failure");
          emitMessage({ kind: "event", event: "recon.failed", label: "recon unavailable; baseline capture retained", status: "warn" });
          // A timed-out adaptive crawler can still leave useful HAR/script
          // traffic behind. Run passive/shadow discovery over that partial
          // capture so the research map does not stop at the landing page.
          if (!streamSignal.aborted) {
            try {
              const { runPostCrawlDiscovery } = await import('../discovery/post-crawl');
              await runPostCrawlDiscovery(params.origin);
              board.addFact('Post-crawl discovery completed over the partial capture after recon failure.', 'post-crawl-fallback');
            } catch (discoveryError) {
              board.addFact(`Post-crawl fallback failed: ${discoveryError instanceof Error ? discoveryError.message : String(discoveryError)}`, 'post-crawl-fallback-failure');
            }
          }
        }
      } else if (lazyServices.crawl && !lazyServices.crawlState && params.ultimatrixConfig?.spider?.enabled === false) {
        board.addFact('Adaptive spider crawl skipped by config; use the baseline browser capture and previously learned graph surface.', 'recon-disabled');
        emitMessage({ kind: 'event', event: 'recon.skipped', label: 'adaptive crawl disabled; reusing observed target surface', status: 'ok' });
      }
    } catch (error) {
      // Observation failure is recoverable: retain an explicit fact so the
      // brain can choose generic HTTP reconnaissance instead of believing the
      // target was observed successfully.
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`[observation] baseline unavailable: ${message}`);
      board.addFact(`Browser observation failed: ${message}. Use bounded HTTP reconnaissance as fallback.`, "observation-failure");
      // Carry the reason. Verified live across 5 runs: the label said only
      // "browser observation unavailable; HTTP fallback allowed", so the operator
      // (and the transcript) could not tell a missing browser from a failed
      // navigation from a capture that collected nothing. Silently degrading to
      // HTTP is defensible; degrading without saying why is not — and it is
      // especially costly here, because the browser layer is where auth-state
      // detection lives, so its absence is the reason auth flows stayed at zero.
      emitMessage({
        kind: "event",
        event: "observation.failed",
        label: `browser observation unavailable: ${message}. HTTP fallback allowed — browser-dependent capabilities (auth state, roles, interaction) are OFF for this engagement.`,
        status: "warn",
        data: { error: message },
      });
    }
  } else if (lazyServices?.observationState?.status === 'failed') {
    // A model/provider fallback shares the same engagement services. Surface
    // the prior capability failure as typed context instead of repeating a
    // browser launch and producing a second misleading progress sequence.
    const message = lazyServices.observationState.error ?? 'browser observation unavailable'
    board.addFact(`Browser observation already failed for this engagement: ${message}. Use bounded HTTP reconnaissance; do not retry browser startup in this turn.`, 'observation-failure-reused')
    emitMessage({ kind: "event", event: "observation.reused", label: "reusing browser failure; HTTP fallback active", status: "warn" })
  }
  const campaignEnabled = params.ultimatrixConfig?.campaign?.auto ?? DEFAULTS.campaign?.auto ?? true
  // F1 FIX: Do NOT call resetTurn() here — capabilities persist across turns.
  // Previously discovered/activated tools (browser, workers, crawl) remain available.

  // Seed a bounded graph-driven research cycle after observation so a cold
  // engagement makes progress even when the model stalls before tool use.
  // Collaborative/ask mode auto-runs only idempotent GETs; explicit run mode
  // authorizes the bounded state-changing experiments selected by the graph.
  const researchBootstrapState = lazyServices?.researchBootstrapState
  const researchBootstrapPending = !lazyServices || researchBootstrapState === undefined || researchBootstrapState === 'pending'
  let researchBootstrapIncomplete = researchBootstrapState === 'attempted'
  if (researchBootstrapPending) {
  const execute = async (tool: any, args: Record<string, unknown>): Promise<any> => {
    if (!tool || typeof tool.execute !== 'function') return { ok: false, error: 'bootstrap tool unavailable' }
    return tool.execute(args, {} as never)
  }
  try {
    // Select and load one canonical methodology skill through the live shared
    // registry. This is the durable setup seam for the generic gate; it is
    // intentionally target-aware via metadata, not a hardcoded prompt or a
    // legacy methodology file.
    emitMessage({ kind: "event", event: "skill.discovery.started", label: "selecting target methodology skill", status: "running", data: { source: "skill-registry" } });
    const skillDiscovery = await (discoverSkillsForTarget as any).execute({ url: params.origin }, {} as never) as any;
    const selectedSkillId = skillDiscovery?.ok && skillDiscovery.value?.suggestions?.[0]?.id
      ? String(skillDiscovery.value.suggestions[0].id)
      : 'web-pentest';
    const methodology = await (loadSkillBodyTool as any).execute({ skillId: selectedSkillId }, {} as never) as any;
    emitMessage({
      kind: "event",
      event: methodology?.ok ? "skill.loaded" : "skill.load.failed",
      label: methodology?.ok ? `loaded methodology skill: ${selectedSkillId}` : `methodology skill unavailable: ${selectedSkillId}`,
      status: methodology?.ok ? "ok" : "warn",
      data: { source: "skill-registry", skillId: selectedSkillId },
    });
    board.addFact(
      methodology?.ok
        ? `Canonical methodology selected: ${selectedSkillId}. Load its body for the target-specific procedure and verification contract.`
        : `Canonical methodology selection unavailable for ${selectedSkillId}; use the research contract and passive evidence only until a skill is loaded.`,
      'methodology',
    );

    // Surface available authorized test identities without exposing secrets.
    // The model can then locate the login flow and authenticate autonomously.
    const credentialInventory = await execute(useCredential, { action: 'list' });
    board.addFact(
      credentialInventory?.ok
        ? `Authorized credential roles available: ${(credentialInventory.roles ?? []).join(', ')}. Locate the login flow, authenticate with an appropriate role, extract browser auth, and save the session before protected testing.`
        : 'No authorized credential roles are configured; continue with anonymous and authorization-boundary testing.',
      'auth-availability',
    );
    const mapResult = await execute(buildResearchMap, { maxHypotheses: 12 });
    const planResult = mapResult?.ok
      ? await execute(planResearchExperiments, { maxExperiments: 6 })
      : undefined;
    if (!mapResult?.ok || !planResult?.ok) {
      throw new Error(String(mapResult?.error ?? planResult?.error ?? 'research map or experiment planning did not complete'));
    }
    const planned = planResult?.ok ? (planResult.value?.experiments ?? []) : [];
    const topHypotheses = Array.isArray(mapResult?.value?.topHypotheses)
      ? mapResult.value.topHypotheses as import('../research/types').ResearchHypothesis[]
      : [];
    const researchExperiments = Array.isArray(planned)
      ? planned as import('../research/types').ResearchExperiment[]
      : [];
    for (const fact of actionLimitBootstrapFacts(topHypotheses, researchExperiments)) {
      board.addFact(fact, 'business-rule-learning');
    }
    for (const fact of plannedResearchBootstrapFacts(topHypotheses, researchExperiments)) {
      board.addFact(fact, 'workflow-research');
    }
    // Synchronize deterministic setup with the brain's methodology gate.
    // Without this, bootstrap-generated maps/plans are invisible to the gate,
    // so the model can spend its entire turn re-discovering setup and stop
    // before active testing.
    (agent as any).setMethodologyState?.({
      methodologyLoaded: Boolean(methodology?.ok),
      researchMapBuilt: Boolean(mapResult?.ok),
      experimentPlanned: Boolean(planResult?.ok && planned.length > 0),
    });
    // Prepare typed work before the brain is built, but leave execution to the
    // goal-aware solver turn. Pre-goal replay used to run the first three GET
    // experiments regardless of relevance or missing workflow prerequisites.
    board.addFact(`Autonomous research bootstrap: ${planned.length} experiments planned and queued for current-goal selection. No experiment ran before goal routing.`, 'research-bootstrap');
    emitMessage({ kind: "event", event: "research.bootstrap.completed", label: `research bootstrap: ${planned.length} experiments queued for goal-aware selection`, status: "ok" });
    lazyServices?.markResearchBootstrapCompleted?.();
  } catch (error) {
    researchBootstrapIncomplete = true
    const message = error instanceof Error ? error.message : String(error);
    board.addFact(`Autonomous research bootstrap unavailable: ${message}; continue with model-selected tools.`, 'research-bootstrap-failure');
    emitMessage({ kind: "event", event: "research.bootstrap.failed", label: "research bootstrap unavailable; model path retained", status: "warn" });
  } finally {
    lazyServices?.markResearchBootstrapAttempted?.();
  }
  } else if (lazyServices?.researchBootstrapState === 'completed') {
    board.addFact('Research bootstrap already completed for this engagement; reusing its graph and captured evidence.', 'research-bootstrap-reused');
    emitMessage({ kind: "event", event: "research.bootstrap.reused", label: "reusing engagement research map", status: "ok" });
  } else if (lazyServices?.researchBootstrapState === 'attempted') {
    board.addFact('Research bootstrap was attempted but did not complete for this engagement; use available observations and report research coverage as incomplete.', 'research-bootstrap-incomplete');
    emitMessage({ kind: "event", event: "research.bootstrap.incomplete", label: "research setup incomplete; using available target observations", status: "warn" });
  }

  // Deterministic coverage consumes the workflow and experiment map built
  // above. Starting it before research bootstrap meant a cold engagement's
  // first campaign could only use the raw crawl graph and miss stateful paths.
  if (params.interactionMode === 'run' && campaignEnabled && lazyServices?.runCoverageCampaign) {
    emitMessage({ kind: 'event', event: 'coverage.started', label: 'running deterministic input coverage', status: 'running' })
    try {
      campaignResult = await lazyServices.runCoverageCampaign(evidence, params.interactionRunId)
      board.addFact(
        `Deterministic coverage ${campaignResult.status}: ${campaignResult.coverage.slicesExecuted} unit(s), ${campaignResult.requestsUsed} HTTP request(s), ${campaignResult.remainingSlices.length} pending unit(s).`,
        'coverage',
      )
      emitMessage({
        kind: 'event',
        event: 'coverage.completed',
        label: `coverage ${campaignResult.status}: ${campaignResult.units.length} unit result(s), ${campaignResult.domains.length} skill domain(s)`,
        status: campaignResult.status === 'complete' ? 'ok' : 'warn',
        data: { status: campaignResult.status, requestsUsed: campaignResult.requestsUsed, domains: campaignResult.domains.length, remaining: campaignResult.remainingSlices.length },
      })
    } catch (error) {
      campaignError = error instanceof Error ? error.message : String(error)
      board.addFact(`Deterministic coverage did not run: ${campaignError}`, 'coverage-failure')
      emitMessage({ kind: 'event', event: 'coverage.failed', label: `coverage unavailable: ${campaignError}`, status: 'warn' })
    }
  }

  const contextRegistry = new ContextWindowRegistry(params.ultimatrixConfig ?? {} as UltimatrixConfig);
  const resolvedContextModel = params.ultimatrixConfig?.model
    ? resolveModelRef(params.ultimatrixConfig, { role: "brain" })
    : undefined;
  const contextModelId = [resolvedContextModel?.modelId, resolvedContextModel?.model, params.model]
    .find(modelId => modelId && contextRegistry.getContextWindow(modelId))
    ?? resolvedContextModel?.modelId
    ?? params.model
    ?? "";
  // F22 FIX: Unknown models get a conservative default (not 128k which causes overflow).
  // The solver logs a warning so operators know to register the model's context window.
  const DEFAULT_CONTEXT_WINDOW = 32_000;
  const contextWindow = contextRegistry.getContextWindow(contextModelId);
  if (!contextWindow && contextModelId) {
    log.warn(`[context] Unknown model "${contextModelId}" — using conservative ${DEFAULT_CONTEXT_WINDOW} token window. Register in ContextWindowRegistry for accurate sizing.`);
  }
  const effectiveContextWindow = contextWindow || DEFAULT_CONTEXT_WINDOW;
  if (resolvedContextModel) {
    emitMessage({
      kind: "event",
      event: "model.selected",
      label: `brain ${resolvedContextModel.modelId}`,
      status: "ok",
      data: {
        role: "brain",
        provider: resolvedContextModel.provider,
        model: resolvedContextModel.model,
        modelId: resolvedContextModel.modelId,
        tier: resolvedContextModel.tier,
        reason: resolvedContextModel.reason,
      },
    });
  }
  const alerts: RuntimeAlert[] = [];
  if (loopDetector.isStale(cfg.staleThreshold)) alerts.push({ type: "stale-execution", count: cfg.staleThreshold });
  const unsupported = evidence.getUnsupportedClaims?.() ?? [];
  if (unsupported.length) alerts.push({ type: "unsupported-claims", count: unsupported.length });

  // Bounded recent blackboard facts — sanitized, length-capped, never bodies.
  const factStrings = board.getFactStrings();
  const recentFacts = factStrings.slice(-8).map((f) => f.length > 240 ? f.slice(0, 237) + "..." : f);
  let capturedRequestTotal: number;
  try {
    capturedRequestTotal = getCapturedRequestStore().size;
  } catch {
    capturedRequestTotal = 0;
  }

  // G10: Expose validated techniques and weight overrides from prior sessions
  let validatedTechniques: string[] = [];
  let techniqueWeights: Array<{ techniqueId: string; weight: number; confidence: number }> = [];
  try {
    const { getTechniqueRegistry } = await import("../skills/technique-registry");
    const reg = getTechniqueRegistry();
    validatedTechniques = reg.getValidatedTechniques();
    const overrides = reg.getAllRuntimeOverrides();
    for (const [techniqueId, override] of overrides) {
      if (override.confidenceDelta !== 0) {
        techniqueWeights.push({
          techniqueId,
          weight: reg.getTechniqueWeight(techniqueId),
          confidence: reg.getTechniqueConfidence(techniqueId),
        });
      }
    }
    techniqueWeights = techniqueWeights.sort((a, b) => b.weight - a.weight).slice(0, 10);
  } catch { /* technique registry not available */ }

  const runtimeEnvelope = buildRuntimeEnvelope({
    target: params.origin,
    contextWindow: effectiveContextWindow,
    graph: getGlobalGraphStore(),
    workflow: params.workflow,
    blackboard: board,
    alerts,
    blackboardFacts: { total: factStrings.length, recent: recentFacts },
    capturedRequests: { total: capturedRequestTotal },
    budget: { steps: 0, maxSteps: cfg.maxToolCalls, elapsedMs: 0, maxDurationMs: cfg.maxDurationMs },
    validatedTechniques,
    techniqueWeights,
  });
  // ─── Build budgeted goal from priority-ordered sections ───
  // Replaces the ad-hoc string concatenation with a single function that
  // respects a model-proportional token budget (5% of context window).
  // Sections are sorted by priority and added until budget is exhausted.
  const goalContent = `${params.goal}${runtimeEnvelope}`;

  const sections: GoalSection[] = [
    { name: 'Goal', priority: 100, content: goalContent },
  ];

  // Coverage status — compact tested/untested summary (~200-500 tokens)
  try {
    const doneIndex = buildDoneIndex(getGlobalGraphStore(), board, 500);
    if (doneIndex.trim()) {
      sections.push({ name: 'Coverage Status', priority: 70, content: doneIndex });
    }
  } catch { /* graph may not be ready */ }

  // Budget-pressure: tell the brain its step + time budget
  const budgetInstruction = [
    `[BUDGET: 0/${cfg.maxToolCalls} steps · 0/${Math.round(cfg.maxDurationMs / 1000)} sec`,
    `You have a hard step and time limit. As you progress, your runtime context shows remaining budget.`,
    `When remaining steps < ${Math.max(5, Math.floor(cfg.maxToolCalls * 0.15))} or remaining time < 60s, STOP exploring and SYNTHESIZE your findings into a final answer.`,
    `If you reach the budget without a clean answer, the system will attempt to compose one from your reasoning and findings — but a proactive answer is always better.]`,
  ].join(' ');
  sections.push({ name: 'Budget', priority: 80, content: budgetInstruction });

  let enrichedGoal = buildBudgetedGoal(sections, params.ultimatrixConfig ?? {});
  const goalContextTruncated = enrichedGoal.includes('[Goal budget:')

  // Stale detection — prepended BEFORE the budgeted goal (highest priority override)
  if (alerts.some(alert => alert.type === "stale-execution")) {
    emit({
      phase: "stale",
      step: 0,
      text: "Stale detection triggered — switching strategy",
    });
    const mandatory = loopDetector.getMandatoryInstruction(cfg.staleThreshold);
    if (mandatory) {
      enrichedGoal = `${mandatory}\n\n---\n\n${enrichedGoal}`;
    }
  }

  const caps = params.modelCapabilities ?? params.ultimatrixConfig?.modelCapabilities;
  const budgetPolicy = params.budgetPolicy ?? params.ultimatrixConfig?.budgetPolicy;
  const registry = new ContextWindowRegistry(params.ultimatrixConfig ?? {} as any);
  const ctxManager = new ContextBudgetManager(caps ?? {}, registry);
  let agentInstructions = "";
  try {
    agentInstructions = (await agent.getInstructions()) as string;
  } catch {}

  let conversationHistory = "";
  if (params.memory) {
    try {
      const memory = await agent.getMemory();
      const recalled = await memory?.recall({
        threadId: params.memory.thread,
        resourceId: params.memory.resource,
        perPage: params.ultimatrixConfig?.memory.lastMessages ?? 20,
      } as any);
      conversationHistory = JSON.stringify(recalled?.messages ?? []);
    } catch {}
  }

  const validateNextContext = async (stage: "initial" | "activation") => {
    const activeTools = await getNextStepTools(agent, capabilityRegistry);
    const toolSchemasStr = await stringifyToolSchemas(activeTools);
    const expectedOutputTokens = registry.getMaxOutput(contextModelId) || 2048;
    const ctxCheck = ctxManager.validateContextFit({
      modelId: contextModelId,
      systemPrompt: agentInstructions,
      toolSchemas: toolSchemasStr,
      conversationHistory,
      enrichedGoal,
      expectedOutputTokens,
    });
    const capacity = ctxManager.getContextWindow(contextModelId) || effectiveContextWindow;
    const hasCapabilityData = Boolean(
      registry.getContextWindow(contextModelId) ||
      (contextModelId && caps?.[contextModelId]) ||
      (resolvedContextModel?.model && caps?.[resolvedContextModel.model]),
    );
    log.dim(`[context] ${stage} ${ctxCheck.totalInputTokens}/${capacity} tokens (${ctxCheck.severity}) [sys=${ctxCheck.breakdown.system} tools=${ctxCheck.breakdown.tools} hist=${ctxCheck.breakdown.history} goal=${ctxCheck.breakdown.goal}]`);
    emitMessage({
      kind: "event",
      event: "context.checked",
      label: `context ${stage} ${ctxCheck.severity}: ${ctxCheck.totalInputTokens}/${capacity} tokens`,
      status: !hasCapabilityData || ctxCheck.severity === "critical" ? "error" : ctxCheck.severity === "warning" ? "warn" : "ok",
      data: {
        modelId: contextModelId,
        totalInputTokens: ctxCheck.totalInputTokens,
        availableForOutput: ctxCheck.availableForOutput,
        severity: ctxCheck.severity,
        fits: ctxCheck.fits,
        stage,
        activeTools: Object.keys(activeTools),
        modelCapabilityKnown: hasCapabilityData,
      },
    });
    if (!hasCapabilityData) {
      contextBlockReason = `Cannot safely dispatch ${contextModelId || "the selected model"}: no verified context-window and output-token metadata is available.`
      emitMessage({
        kind: "event",
        event: "context.blocked",
        label: contextBlockReason,
        status: "error",
        data: { modelId: contextModelId, stage, totalInputTokens: ctxCheck.totalInputTokens, capacity },
      });
      throw new Error(contextBlockReason)
    }
    if (goalContextTruncated) {
      contextBlockReason = "The required goal context exceeded its budget and was truncated; dispatch was blocked to preserve the complete task."
      emitMessage({
        kind: "event",
        event: "context.blocked",
        label: contextBlockReason,
        status: "error",
        data: { modelId: contextModelId, stage, capacity, reason: "goal-truncated" },
      })
      throw new Error(contextBlockReason)
    }
    if (!ctxCheck.fits || ctxCheck.severity === "critical") {
      const enforcement = budgetPolicy?.enforcement ?? "soft";
      if (enforcement === "hard") {
        contextBlockReason =
          `Context overflow: ${ctxCheck.totalInputTokens} tokens exceeds model capacity. ` +
            `Suggestions: ${ctxCheck.suggestions.join("; ")}`
        emitMessage({
          kind: "event",
          event: "context.blocked",
          label: contextBlockReason,
          status: "error",
          data: { modelId: contextModelId, stage, totalInputTokens: ctxCheck.totalInputTokens, capacity },
        })
        throw new Error(contextBlockReason)
      }
      if (enforcement === "soft") {
        // ─── Adaptive Context: compress instructions + reduce tools ──
        // 1. Plan what compression level this model needs
        const adaptivePlan = planAdaptiveContext({
          contextWindow: capacity,
          systemPromptTokens: ctxCheck.breakdown.system,
          toolSchemasTokens: ctxCheck.breakdown.tools,
          goalTokens: ctxCheck.breakdown.goal,
          historyTokens: ctxCheck.breakdown.history,
          reservedOutputTokens: expectedOutputTokens,
        });

        // 2. Compress brain instructions if needed
        if (adaptivePlan.detailLevel !== "full") {
          const originalTokens = ctxManager.estimateTokens(agentInstructions);
          agentInstructions = compressBrainInstructions(agentInstructions, adaptivePlan);
          const compressedTokens = ctxManager.estimateTokens(agentInstructions);
          log.dim(`[context] Adaptive: compressed brain ${originalTokens}→${compressedTokens} tokens (${adaptivePlan.detailLevel})`);
          emitMessage({
            kind: "event",
            event: "context.adaptive",
            label: `brain compressed ${originalTokens}→${compressedTokens} tokens (${adaptivePlan.detailLevel})`,
            status: "ok",
            data: { plan: adaptivePlan.detailLevel, originalTokens, compressedTokens },
          });
        }

        // 3. Reduce tool surface if needed
        // F20 FIX: The brain's prepareStep (in brain-tools.ts:311) already calls
        // filteredCurrentTools() which applies the adaptive budget. The old
        // setTurnTools() method never existed on the agent — this block was dead code.
        // Tool filtering is now handled by prepareStep returning the filtered set.
        const allToolEntries = Object.entries(activeTools);
        if (allToolEntries.length > adaptivePlan.toolBudget) {
          log.dim(`[context] Adaptive: tools ${allToolEntries.length} exceed budget ${adaptivePlan.toolBudget} — prepareStep will filter`);
        }

        // 4. Re-validate; preserve the required goal and evidence if it still overflows.
        const reCheck = ctxManager.validateContextFit({
          modelId: contextModelId,
          systemPrompt: agentInstructions,
          toolSchemas: await stringifyToolSchemas(activeTools),
          conversationHistory,
          enrichedGoal,
          expectedOutputTokens,
        });
        if (!reCheck.fits) {
          contextBlockReason =
            `Context remains over capacity after safe instruction compression (${reCheck.totalInputTokens} input tokens; ${capacity} token window). Required goal and evidence context was preserved.`
          emitMessage({
            kind: "event",
            event: "context.blocked",
            label: contextBlockReason,
            status: "error",
            data: { modelId: contextModelId, stage, totalInputTokens: reCheck.totalInputTokens, capacity },
          })
          throw new Error(contextBlockReason)
        }
      }
    }
  };

  emit({ phase: "observe", step: 0, text: "" });

  let fullText = "";
  let streamIndex = 0;
  // Structured capture: answer (deliverable) vs reasoning (transient scratch).
  // Both channels (text-delta AND the canonical stream.text promise) feed `answerText` via appendDelta.
  let answerText = "";
  let reasoningText = "";
  let toolCallCount = 0;
  let toolCallIdCounter = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let lastError: string | undefined;
  /** Typed model/provider failure observed on the stream (which never throws). */
  let streamError: string | undefined;
  // Unknown tool names can come from stale model context or connector
  // hallucinations. Allow the model to recover from a few of these within the
  // same stream; terminate only when it keeps selecting unavailable tools.
  let unavailableToolErrors = 0;
  let terminalFailureReason: Extract<SolveResult['reason'], 'context_blocked' | 'model_failed' | 'tool_unavailable' | 'browser_failed' | 'tool_failed'> | undefined;
  let ranCapabilityTurn = false;
  // Snapshot graph state for stale detection (compare before/after tool calls)
  const graphStateSnapshot = { findings: 0, endpoints: 0, tests: 0 };
  // F14 FIX: Immutable turn-start snapshot for accurate newFindings delta.
  // graphStateSnapshot is mutated during the turn for stale detection;
  // turnStartSnapshot stays frozen so newFindings = current - turnStart.
  const turnStartSnapshot = { findings: 0, endpoints: 0, tests: 0 };
  let contextBlockReason: string | undefined;
  try {
    const graphStore = getGlobalGraphStore();
    const initialSummary = graphStore.getTargetSummary();
    graphStateSnapshot.findings = initialSummary.totalFindings;
    graphStateSnapshot.endpoints = initialSummary.totalEndpoints;
    graphStateSnapshot.tests = initialSummary.totalTests;
    turnStartSnapshot.findings = initialSummary.totalFindings;
    turnStartSnapshot.endpoints = initialSummary.totalEndpoints;
    turnStartSnapshot.tests = initialSummary.totalTests;
    emitMessage({
      kind: "event",
      event: "memory.loaded",
      label: `graph memory ${initialSummary.totalEndpoints} endpoints · ${initialSummary.totalFindings} findings · ${initialSummary.totalTests} tests`,
      status: "ok",
      data: {
        source: "graph",
        endpoints: initialSummary.totalEndpoints,
        findings: initialSummary.totalFindings,
        tests: initialSummary.totalTests,
      },
    });
  } catch {
    // Graph store not available
  }

  capabilityRegistry?.setActivationPolicy((descriptor) => {
    const maxCalls = budgetPolicy?.maxModelCallsPerTask;
    if (!maxCalls || maxCalls <= 0) return true;
    const heavy =
      descriptor.namespace === "workers" ||
      descriptor.namespace === "crawl" ||
      descriptor.id === "runCampaign";
    if (!heavy) return true;
    const provider = resolvedContextModel?.provider ?? params.ultimatrixConfig?.provider;
    if (!provider) return true;
    const used = getGlobalQuotaTracker().getStatus()[provider]?.used ?? 0;
    return used < maxCalls;
  });
  capabilityRegistry?.setActivationObserver(async (descriptor) => {
    ranCapabilityTurn ||= descriptor.readOnly === false || ["browser", "crawl", "workers"].includes(descriptor.namespace);
    await validateNextContext("activation");
  });

  try {
    // F26 FIX: Set interaction mode before agent.stream() so askUser/askUserConfirm
    // auto-approve in 'run' mode. Reset after the stream completes.
    setInteractionMode(params.interactionMode);
    await validateNextContext("initial");

    const progressTimeoutMs = resolveProgressTimeoutMs(cfg.maxDurationMs, cfg.progressTimeoutMs)
    const stream = await withPromiseTimeout(agent.stream(enrichedGoal, {
      maxSteps: cfg.maxToolCalls,
      ...(params.memory ? { memory: params.memory } : {}),
      abortSignal: streamSignal,
    }), progressTimeoutMs, "Model stream startup", streamSignal);

    let lastToolCallArgs: Record<string, unknown> | undefined;
    let lastToolCallId: string | undefined;
    const workerToolNames = new Set(["spawnWorker", "spawn-worker", "spawnSwarm", "spawn-swarm", "runTaskGraph", "run-task-graph"]);

    for await (const chunk of withProgressWatchdog(stream.fullStream, progressTimeoutMs, streamSignal)) {
      if (streamSignal.aborted) {
        throw new Error(params.signal?.aborted
          ? "Solver interrupted"
          : `Solver timeout: ${cfg.maxDurationMs}ms exceeded`);
      }
      switch (chunk.type) {
        case "error":
          // A model/provider failure arrives as a TYPED stream event, and the
          // stream then ends normally — it does not throw. Verified live: a 503
          // from the provider printed "Error in agent stream" to stderr, this
          // switch had no case for it, the loop ended cleanly, `lastError` stayed
          // undefined, and the operator got "No deliverable response was
          // produced." with a `stale` turn and no explanation. The information
          // was available and typed; it was simply dropped. Captured here and
          // classified below so a provider outage reads as what it is.
          streamError = describeStreamError(chunk.payload);
          break;

        case "text-delta":
          fullText += chunk.payload.text;
          // Live answer channel: appendDelta deduplicates cumulative provider
          // chunks (nvidia sends full text each time) and passes through
          // incremental chunks (openai/anthropic) unchanged.
          answerText = appendDelta(answerText, chunk.payload.text);
          emitMessage({ kind: "answer", text: chunk.payload.text, index: streamIndex++ });
          // F15 FIX: Extract attack path from assistant's VISIBLE text output,
          // not from tool-result output. The brain is instructed to declare
          // [PATH: <class>] in its visible output.
          const detectedPathInText = extractAttackPath(fullText);
          if (detectedPathInText) {
            loopDetector.recordAttackPath(detectedPathInText);
          }
          break;

        case "reasoning-delta":
          if (chunk.payload.text) {
            // Transient scratch: captured for the structured `answer.reasoning`
            // field and shown live, never treated as the deliverable.
            reasoningText = appendDelta(reasoningText, chunk.payload.text);
            emitMessage({ kind: "reasoning", text: chunk.payload.text, index: streamIndex++ });
          }
          break;

        case "tool-call":
          if (chunk.payload.toolName && chunk.payload.toolName !== "askUser") {
            toolCallCount++;
            const currentToolCallId = `tc-${++toolCallIdCounter}`;
            lastToolCallArgs = chunk.payload.args as Record<string, unknown> | undefined;
            lastToolCallId = currentToolCallId;

            // Record tool call into blackboard for dedup + prompt graph
            try {
              const argsStr = lastToolCallArgs ? JSON.stringify(lastToolCallArgs).slice(0, 200) : '';
              board.recordToolCall(chunk.payload.toolName, argsStr);
            } catch { /* non-critical */ }

            const descriptor = await capabilityRegistry?.describe(chunk.payload.toolName);
            emit({
              phase: "reason",
              step: toolCallCount,
              toolName: chunk.payload.toolName,
              toolArgs: chunk.payload.args,
              activity: descriptor?.activity,
            });
            emitMessage({
              kind: "tool",
              name: chunk.payload.toolName,
              args: chunk.payload.args as Record<string, unknown> | undefined,
              toolCallId: currentToolCallId,
            });
            if (workerToolNames.has(chunk.payload.toolName)) {
              const args = chunk.payload.args as Record<string, unknown> | undefined;
              emitMessage({
                kind: "event",
                event: "worker.spawned",
                label: `worker ${String(args?.skillId ?? chunk.payload.toolName)} ${String(args?.complexity ?? "medium")}`,
                status: "running",
                data: {
                  tool: chunk.payload.toolName,
                  skillId: args?.skillId,
                  complexity: args?.complexity ?? "medium",
                  tier: args?.tier,
                  modelId: args?.modelId,
                },
              });
            }
          }
          break;

        case "tool-result":
          if (chunk.payload.toolName) {
            const result = chunk.payload.result as any;
            const output =
              typeof result === "string"
                ? result
                : JSON.stringify(result) ?? String(result);
            const toolOk = !(
              result &&
              typeof result === "object" &&
              (result.ok === false || result.success === false || result.status === "failed" || result.error)
            );

            // Record tool output in evidence gate
            evidence.recordToolOutput(output);

            emitMessage({ kind: "tool-result", name: chunk.payload.toolName, ok: toolOk, result: output, toolCallId: lastToolCallId });
            if (workerToolNames.has(chunk.payload.toolName) && result && typeof result === "object") {
              const routing = result.routing && typeof result.routing === "object" ? result.routing : undefined;
              emitMessage({
                kind: "event",
                event: toolOk ? "worker.completed" : "worker.failed",
                label: routing?.modelId
                  ? `worker ${result.status ?? (toolOk ? "completed" : "failed")} ${routing.provider ? `${routing.provider}/` : ""}${routing.modelId}`
                  : `worker ${result.status ?? (toolOk ? "completed" : "failed")}`,
                status: toolOk ? "ok" : "error",
                data: {
                  workerId: result.workerId,
                  status: result.status,
                  routing,
                  graphDiff: result.graphDiff,
                },
              });
            }

            // F15 FIX: Attack path extraction moved to text-delta handler (line ~701).
            // The brain declares [PATH:] in visible output, not in tool results.

            // Determine if this tool call produced graph changes (not just tool name substring)
            let hasNewFinding = false;
            try {
              const graphAfter = getGlobalGraphStore();
              const summaryAfter = graphAfter.getTargetSummary();
              if (summaryAfter.totalFindings > graphStateSnapshot.findings ||
                  summaryAfter.totalEndpoints > graphStateSnapshot.endpoints ||
                  summaryAfter.totalTests > graphStateSnapshot.tests) {
                hasNewFinding = true;
              }
              // Update snapshot for next iteration
              graphStateSnapshot.findings = summaryAfter.totalFindings;
              graphStateSnapshot.endpoints = summaryAfter.totalEndpoints;
              graphStateSnapshot.tests = summaryAfter.totalTests;
            } catch {
              // Graph store not available — treat as no finding
            }

            // F17 FIX: Only track stale rounds when there is MEANINGFUL progress.
            // Previously every tool call incremented the stale counter, causing
            // informational tools (queryGraph, getSessionContext) to trigger staleness.
            // Now we only reset on actual findings/endpoint/test changes.
            if (hasNewFinding) {
              loopDetector.recordRound(true);
            }

            // F18 FIX: Record BOTH failures AND successes in reflexion engine.
            // Previously only failures were recorded, causing failure state to
            // accumulate across productive turns without reset.
            if (toolOk) {
              reflexion.recordAttempt(
                chunk.payload.toolName,
                true,
                null,
                "",
                undefined,
              );
            } else {
                const vulnType = extractVulnType(lastToolCallArgs);
                reflexion.recordAttempt(
                  chunk.payload.toolName,
                  false,
                  null,
                  result.error || output,
                  vulnType,
                );
                if (vulnType) {
                  import("../intelligence/evolution").then(({ recordTechniqueFailed }) => recordTechniqueFailed(vulnType)).catch(() => {});
                }
            }

            // Notify caller (graph save, etc.)
            params.onToolComplete?.(
              chunk.payload.toolName,
              chunk.payload.result,
            );
          }
          break;

        case "tool-error":
          if (chunk.payload.toolName) {
            const error = chunk.payload.error instanceof Error
              ? chunk.payload.error.message
              : String(chunk.payload.error ?? "Unknown tool error");
            log.error(
              `${chunk.payload.toolName} failed: ${error}`,
            );
            emitMessage({
              kind: "tool-result",
              name: chunk.payload.toolName,
              ok: false,
              result: error,
            });

            // Record failure in reflexion engine
              const vulnType = extractVulnType(lastToolCallArgs);
              reflexion.recordAttempt(
                chunk.payload.toolName,
                false,
                null,
                error,
                vulnType,
              );
              if (vulnType) {
                import("../intelligence/evolution").then(({ recordTechniqueFailed }) => recordTechniqueFailed(vulnType)).catch(() => {});
              }

            // Record error in loop detector (counts as no progress)
            loopDetector.recordRound(false);

            forensicLog?.log({
              type: "tool-error",
              agent: "solver-brain",
              tool: chunk.payload.toolName,
              error,
            });

            // An unavailable capability is usually recoverable: the model may
            // have stale connector metadata or selected a capability that was
            // deliberately gated. Keep the stream alive so it can inspect the
            // returned error and choose an actually registered tool. Repeated
            // invalid calls still fail closed to prevent an unbounded loop.
            if (/tool .*not found|available tools:/i.test(error)) {
              unavailableToolErrors += 1;
              if (unavailableToolErrors >= 3) {
                terminalFailureReason = "tool_unavailable";
                throw new Error(`Tool unavailable after ${unavailableToolErrors} invalid selections: ${error}`);
              }
            }

            if (/browser|stagehand|page|navigation/i.test(error)) {
              terminalFailureReason = "browser_failed";
            }
          }
          break;

        case "finish":
          if (chunk.payload.usage) {
            const usage = chunk.payload.usage as Record<string, number>;
            totalInputTokens = usage.inputTokens ?? 0;
            totalOutputTokens = usage.outputTokens ?? 0;
            totalTokens =
              usage.totalTokens ?? totalInputTokens + totalOutputTokens;
          }
          break;
      }

      // Yield to event loop periodically to allow enqueued SSE data to flush.
      // Without this, rapid bursts of chunks get processed before the
      // ReadableStream/TransformStream can push data to the HTTP response.
      if (streamIndex % 5 === 0 && streamIndex > 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    // A stream-level model failure is terminal for the turn but arrives without
    // throwing, so it must be promoted into the same typed failure channel the
    // throw path uses. Ordering matters: an answer the model already delivered
    // wins, because a provider hiccup on the final chunk should not erase a real
    // result. Only a turn with nothing to show reports the failure.
    if (streamError && !lastError) {
      const classified = classifyModelFailure(streamError, {
        interrupted: Boolean(params.signal?.aborted),
        timedOut: timeoutSignal.aborted,
        timeoutMs: cfg.maxDurationMs,
        existingReason: terminalFailureReason,
      });
      if (classified.reason) terminalFailureReason = classified.reason;
      lastError = classified.message;
      emitMessage({
        kind: "event",
        event: "turn.failed",
        label: lastError,
        status: "error",
        data: { source: "stream", reason: terminalFailureReason, message: streamError },
      });
    }

    // CRITICAL: resolve the SDK-canonical final answer and reasoning. The AI SDK
    // normalizes EVERY provider into two promises:
    //   - stream.text         → the deliverable answer (deduped, provider-clean)
    //   - stream.reasoningText → the model's reasoning/thinking (undefined if the
    //     provider emits none)
    // These are the single source of truth for the committed result. The raw
    // `text-delta` / `reasoning-delta` chunks are TRANSIENT display only and must
    // never become the deliverable — doing so is what let provider reasoning (or
    // echoed deltas) leak into the answer and duplicate it N×. We fall back to the
    // accumulated deltas ONLY when the SDK returns empty (e.g. a provider or mock
    // that resolves the canonical promise late / not at all).
    let canonicalAnswer = "";
    let canonicalReasoning = "";
    try {
      // Await the SDK canonical promises directly — they are the deduplicated,
      // provider-normalized final text. No timeout: the outer
      // AbortSignal.timeout(maxDurationMs) already bounds wall-clock time.
      const [resolvedObject, resolvedText, resolvedReasoning] = await Promise.all([
        withPromiseTimeout(
          ((stream as any).object ?? Promise.resolve(undefined)) as Promise<unknown>,
          progressTimeoutMs,
          "Model canonical object",
          streamSignal,
        ),
        withPromiseTimeout(stream.text as Promise<string | undefined>, progressTimeoutMs, "Model canonical text", streamSignal),
        withPromiseTimeout(
          stream.reasoningText as Promise<string | undefined>,
          progressTimeoutMs,
          "Model canonical reasoning",
          streamSignal,
        ),
      ]);
      const objectResponse = resolvedObject && typeof resolvedObject === "object" && "response" in resolvedObject
        ? (resolvedObject as { response?: unknown }).response
        : undefined;

      if (typeof objectResponse === "string" && objectResponse.trim().length > 0) {
        canonicalAnswer = objectResponse;
      } else if (resolvedText && resolvedText.trim().length > 0) {
        canonicalAnswer = resolvedText;
      }
      if (resolvedReasoning && resolvedReasoning.trim().length > 0) {
        canonicalReasoning = resolvedReasoning;
      }
    } catch {
      // The canonical promises may reject if the underlying stream errored; the
      // delta buffers below serve as the fallback.
    }

    // Commit the canonical answer. When present it supersedes the raw deltas;
    // otherwise keep what the live channel captured. The canonical answer is
    // delivered via the `done` event + SolveResult.text, NOT re-emitted as a
    // live `answer` chunk (that would cause the renderer to print it twice).
    if (canonicalAnswer) {
      answerText = canonicalAnswer;
    }
    // Commit the canonical reasoning. When present it supersedes the raw
    // reasoning-delta chunks; otherwise keep what was captured live.
    if (canonicalReasoning) {
      reasoningText = canonicalReasoning;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const classified = contextBlockReason
      ? undefined
      : classifyModelFailure(errMsg, {
          interrupted: Boolean(params.signal?.aborted),
          timedOut: timeoutSignal.aborted,
          timeoutMs: cfg.maxDurationMs,
          existingReason: terminalFailureReason,
        });
    if (contextBlockReason) terminalFailureReason = "context_blocked";
    else if (classified?.reason) terminalFailureReason = classified.reason;
    lastError = contextBlockReason ?? classified?.message ?? errMsg;
    // Keep provider/memory failures visible to interactive renderers. The
    // structured done envelope still carries the same status, but a live
    // ChatBox needs an event it can paint before the turn is closed.
    emitMessage({
      kind: "event",
      event: "turn.failed",
      label: lastError,
      status: "error",
      data: { reason: terminalFailureReason ?? "model_failed" },
    });
    log.error(lastError);
    forensicLog?.log({
      type: "error",
      agent: "solver-brain",
      error: lastError,
    });
  }
  capabilityRegistry?.setActivationObserver(undefined);
  capabilityRegistry?.setActivationPolicy();

  let newFindings = 0;
  try {
    const currentSummary = getGlobalGraphStore().getTargetSummary();
    // F14 FIX: Use immutable turnStartSnapshot (not the rolling graphStateSnapshot
    // which is mutated during tool calls). This ensures newFindings accurately
    // reflects what THIS turn actually discovered.
    // Multi-attempt turns floor at the caller-supplied baseline (taken before
    // attempt 1) so a retry cannot hide findings its failed attempt recorded.
    const baseline = params.turnStartFindings !== undefined
      ? Math.min(turnStartSnapshot.findings, params.turnStartFindings)
      : turnStartSnapshot.findings;
    newFindings = Math.max(
      0,
      currentSummary.totalFindings - baseline,
    );
  } catch {
    // Graph store not available
  }

  // Classify this turn from its own work, not findings persisted by older runs.
  const { completed, reason } = terminalFailureReason
    ? { completed: false, reason: terminalFailureReason }
    : params.signal?.aborted
    ? { completed: false, reason: "interrupted" as const }
    : timeoutSignal.aborted
      ? { completed: false, reason: "budget_reached" as const }
    : lastError?.startsWith("Target grounding failed:")
      ? { completed: false, reason: "grounding_failed" as const }
      : checkCompletion(
          toolCallCount,
          answerText,
          reasoningText,
          newFindings,
        );

  // Find attack paths (CONCLUDE phase)
  try {
    const { findAttackPaths } = await import("./attack-path");
    const attackPaths = findAttackPaths(getGlobalGraphStore());
    if (attackPaths.length > 0) {
      board.addFact(`Found ${attackPaths.length} attack path(s) from unauthenticated entry points to sensitive assets`, "finding");
      for (const ap of attackPaths.slice(0, 3)) {
        board.addFact(`Attack path: ${ap.entryPoint} → ${ap.targetAsset} (${ap.totalSeverity}, ${ap.chainLength} hops)`, "finding");
      }
      emit({ phase: "complete", step: toolCallCount, text: `\n[attack-paths] ${attackPaths.length} path(s) found (highest: ${attackPaths[0].totalSeverity})` });
    }
  } catch {
    // Attack path analysis is best-effort
  }

  // Persist reflexion state for future sessions
  if (params.reflexion && params.reflexion.getAttemptCount() > 0) {
    try {
      saveReflexionState(params.reflexion, "solver-brain", params.origin);
    } catch {}
  }

  // ─── Orchestration diagnosis (Phase 9 / T7) ────────────────────────
  // Structured pre-flight before the escalation spine: surface high-priority
  // missing context + ranked candidates so the next brain turn plans on real
  // state (diagnose before advanced testing). Best-effort; never a blocker.
  if (!lastError && ranCapabilityTurn) {
    try {
      const { diagnoseTargetState } = await import("../orchestration/diagnosis");
      const profile = diagnoseTargetState({});
      const highGaps = profile.missingContext.filter((m) => m.priority === "high");
      if (highGaps.length > 0) {
        board.addFact(
          `Diagnosis before advanced testing: ${highGaps.length} high-priority gap(s) to close first: ${highGaps
            .map((g) => g.context)
            .join(", ")}. Close them (capture sessions/roles, configure OAST, introspect schemas) then re-run diagnosis.`,
          "context",
        );
      }
    } catch {
      /* best-effort */
    }
  }

  // ─── Exploitation loop (weaponization spine) ───────────────────────
  // Single escalation driver: after a finding lands, build exploit proofs,
  // capture impact, reuse held sessions to pivot within scope, then emit a
  // deliverable report. Driven by the typed ExploitationTracker agenda
  // (which folds in relation-seeded chain proposals). Bounded by
  // maxActiveChainSteps so it never hijacks the turn's budget.
  if (
    !lastError &&
    ranCapabilityTurn &&
    (params.ultimatrixConfig?.engine === "solver" ||
      params.ultimatrixConfig?.engine === "multi-model")
  ) {
    const maxExploitSteps =
      params.ultimatrixConfig?.solver?.maxActiveChainSteps ?? 3;
    if (maxExploitSteps > 0) {
      try {
        const { runExploitationLoop } = await import("./exploitation-loop");
        board.addIntent(
          "Escalate confirmed findings into weaponized proofs: build exploit proofs, capture impact, reuse held sessions to pivot within scope, then emit a deliverable report.",
        );
        emit({
          phase: "attack",
          step: toolCallCount,
          text: `[exploitation-loop] escalating confirmed findings (max ${maxExploitSteps} steps)...`,
        });
        const loopRes = await runExploitationLoop({ maxSteps: maxExploitSteps });
        for (const note of loopRes.notes) {
          board.addFact(note, "finding");
        }
        if (loopRes.executed > 0) {
          emit({
            phase: "complete",
            step: toolCallCount,
            text: `[exploitation-loop] ${loopRes.executed} escalation step(s) executed; ${loopRes.proofsBuilt} proof(s) built`,
          });
        }
      } catch (err) {
        log.warn(`[exploitation-loop] skipped: ${(err as Error).message}`);
      }
    }
  }

  emit({ phase: "complete", step: toolCallCount, reason });

  // Record usage in global tracker
  if (totalTokens > 0) {
    const [provider = "unknown", model = "unknown"] = (
      params.model ?? ""
    ).split("/");
    getGlobalUsageTracker().record(
      provider,
      model,
      totalInputTokens,
      totalOutputTokens,
    );
  }

  // Assemble the structured final answer (single source of truth for UI).
  // F28 FIX: Synthesize ONLY from findings and plan — never from reasoning.
  // Reasoning is transient scratch; incorporating it into the answer creates
  // confusing echo/duplication when the UI also shows reasoning separately.
  let answerContent = visibleAssistantText(answerText).trim();
  const answerReasoning = reasoningText.trim();

  // A provider can finish after emitting only reasoning or tool calls. That
  // is a valid execution outcome, but an empty answer is not a valid user
  // contract: it makes the REPL look frozen and leaves API consumers unable to
  // distinguish “nothing was produced” from a transport failure. Synthesize a
  // factual status from typed execution state only; never infer a finding.
  if (!answerContent) {
    if (lastError) {
      answerContent = `Assessment could not complete: ${lastError}`;
    } else if (toolCallCount > 0) {
      answerContent = `Assessment stopped after ${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"}; no new verified findings were produced.`;
    } else if (answerReasoning) {
      answerContent = "The model ended without producing a deliverable response.";
    } else {
      answerContent = "No deliverable response was produced.";
    }
    emitMessage({
      kind: "event",
      event: "answer.synthesized",
      label: "generated an explicit execution-status response",
      status: "warn",
      data: { reason, toolCalls: toolCallCount, hadReasoning: Boolean(answerReasoning), hadError: Boolean(lastError) },
    });
  }
  const hasVisibleAnswer = answerContent.length > 0;

  if (!hasVisibleAnswer && newFindings > 0) {
    const parts: string[] = [];
    // Findings summary (highest-signal — the ONLY source for synthesized answers)
    try {
      const store = getGlobalGraphStore();
      const findingNodes = (store.queryNodes?.(NodeType.FINDING) || []) as Array<{
        properties?: { severity?: string; technique?: string; endpoint?: string };
      }>;
      const recent = findingNodes.slice(-5);
      if (recent.length > 0) {
        parts.push(`**${recent.length} finding(s) discovered:**`);
        for (const f of recent) {
          const sev = f.properties?.severity ?? 'unknown';
          const tech = f.properties?.technique ?? '';
          const ep = f.properties?.endpoint ? ` @ ${f.properties.endpoint}` : '';
          parts.push(`- [${sev}] ${tech}${ep}`);
        }
      }
    } catch { /* graph unavailable */ }
    // Plan summary (what the brain was trying to do)
    try {
      const plan = board.planSummary?.();
      if (plan && plan !== '(no plan)') parts.push(`**Plan:** ${plan}`);
    } catch { /* plan unavailable */ }
    if (parts.length > 0) {
      answerContent = parts.join('\n\n');
      emitMessage({ kind: "event", event: "answer.synthesized", label: `synthesized answer from ${parts.length} finding(s)`, status: "ok" });
    }
  }
  let findingRefs: SolverAnswer["findings"] = [];
  try {
    const store = getGlobalGraphStore();
    const findingNodes = (store.queryNodes?.(NodeType.FINDING) || []) as Array<{
      properties?: { findingId?: string; severity?: string; technique?: string; endpoint?: string };
    }>;
    findingRefs = findingNodes.slice(0, 10).map((f) => ({
      id: f.properties?.findingId ?? "unknown",
      severity: f.properties?.severity ?? "unknown",
      technique: f.properties?.technique ?? "unknown",
      endpoint: f.properties?.endpoint,
    }));
  } catch {
    // Graph store not available
  }

  const assessmentReport = params.interactionMode === 'run'
    ? buildAssessmentReport({
        discovery: (() => {
          const graph = getEngagementServices()?.graph;
          const count = (type: NodeType) => {
            try { return graph?.queryNodes(type).length ?? 0 } catch { return 0 }
          }
          return {
            pages: count(NodeType.PAGE),
            endpoints: count(NodeType.ENDPOINT),
            inputs: count(NodeType.INPUT),
            workflows: (() => {
              try {
                return graph?.queryNodes(NodeType.WORKFLOW).filter(node => hasObservedWorkflowSequence((node as any).properties)).length ?? 0
              } catch { return 0 }
            })(),
            authFlows: count(NodeType.AUTH_FLOW),
            roles: count(NodeType.RBAC_ROLE),
          }
        })(),
        research: (() => {
          const graph = getEngagementServices()?.graph
          const nodes = (type: NodeType) => {
            try { return graph?.queryNodes(type) ?? [] } catch { return [] }
          }
          return {
            entities: nodes(NodeType.ENTITY).length,
            businessLogicFacts: nodes(NodeType.FACT).filter(node => String((node as any).properties?.source ?? '') === 'business-logic-analyser').length,
            hypotheses: nodes(NodeType.HYPOTHESIS).map(node => ({ kind: String((node as any).properties?.kind ?? 'unknown') })),
            experiments: nodes(NodeType.EXPERIMENT).map(node => ({ status: String((node as any).properties?.status ?? 'unknown') })),
          }
        })(),
        spiderEnabled: params.ultimatrixConfig?.spider?.enabled !== false,
        observation: (() => {
          const state = lazyServices?.observationState
          return state?.status === 'completed'
            ? { status: state.status, requests: state.result?.requests }
            : state
        })(),
        crawl: (() => {
          const state = lazyServices?.crawlState as { stopReason?: string; pagesSeen?: number; frontier?: unknown[] } | undefined
          return state ? { stopReason: state.stopReason, pagesSeen: state.pagesSeen, frontierRemaining: state.frontier?.length } : undefined
        })(),
        researchBootstrapIncomplete,
        campaignEnabled,
        campaign: campaignResult,
        campaignError,
        solverReason: reason,
        tasks: lazyServices?.taskStates,
      })
    : undefined;

  const answer: SolverAnswer = {
    content: answerContent,
    reasoning: answerReasoning,
    findings: findingRefs,
    planSummary: board.planSummary?.() || undefined,
    status: reason,
    completed,
    ...(assessmentReport ? { assessmentStatus: assessmentReport.status, assessmentReport } : {}),
    ...(campaignResult ? { campaign: campaignResult } : {}),
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    durationMs: Date.now() - startTime,
    steps: toolCallCount,
    toolCalls: toolCallCount,
    newFindings,
  };

  // F23 FIX: Wire model routing feedback so the ModelSelector learns which
  // provider/model combos succeed vs fail. Previously recordSuccess/recordFailure
  // were defined in selector.ts but never called from the solver loop.
  if (resolvedContextModel?.provider && resolvedContextModel?.modelId) {
    const selector = getEngagementServices()?.modelSelector;
    if (selector) {
      if (completed) {
        selector.recordSuccess(resolvedContextModel.provider, resolvedContextModel.modelId);
      } else if (!completed) {
        selector.recordFailure(resolvedContextModel.provider, resolvedContextModel.modelId);
      }
    }
  }

  // F26 FIX: Reset interaction mode after solver completes.
  setInteractionMode(undefined);

  emitMessage({ kind: "done", answer });

  return {
    interactionMode: params.interactionMode,
    completed,
    reason,
    steps: toolCallCount,
    toolCalls: toolCallCount,
    newFindings,
    tokensUsed: totalTokens || fullText.length,
    durationMs: Date.now() - startTime,
    facts: board.facts?.length || 0,
    intents: board.intents?.length || 0,
    planSummary: board.planSummary?.() || "",
    text: answerContent || undefined,
    answer,
    error: lastError || undefined,
    ...(assessmentReport ? { assessmentStatus: assessmentReport.status, assessmentReport } : {}),
    ...(campaignResult ? { campaign: campaignResult } : {}),
    ...(campaignError ? { campaignError } : {}),
  };
}

export {};
