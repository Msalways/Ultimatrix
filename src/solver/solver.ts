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
import { resolveModelRef } from "../models/routing";
import { appendDelta, visibleAssistantText } from "../output/render-model";
import { buildRuntimeEnvelope, type RuntimeAlert } from "../runtime/context-envelope";
import { getCapturedRequestStore } from "../capture/captured-request-store";
import { CrossEngagementMemory } from "../intelligence/cross-engagement";
import type { WorkflowStore } from "../workflow/store";
import type { DynamicToolRegistry } from "../extensions/tool-registry";
import { decideTurnRoute } from "./turn-router";

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
  planSummary?: string;
  status: SolveResult["reason"];
  completed: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
  steps: number;
  toolCalls: number;
  /** Findings added during this turn, excluding persisted findings. */
  newFindings: number;
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
  | { kind: "tool"; name: string; args?: Record<string, unknown>; workerId?: string; workerName?: string }
  | { kind: "tool-result"; name: string; ok: boolean; result?: string; workerId?: string; workerName?: string }
  | { kind: "phase"; phase: SolverPhase; step: number }
  | { kind: "event"; event: string; label: string; status?: "info" | "running" | "ok" | "warn" | "error"; data?: Record<string, unknown> }
  | { kind: "done"; answer: SolverAnswer };

export interface SolverConfig {
  maxToolCalls?: number;
  maxDurationMs?: number;
  staleThreshold?: number;
  maxParallel?: number;
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
    | "frontier_exhausted"
    | "budget_reached"
    | "stale"
    | "interrupted";
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
}

export interface SolveParams {
  origin: string;
  goal: string;
  interactionMode?: "ask" | "run";
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
}

const SOLVER_DEFAULTS: Required<SolverConfig> = {
  maxToolCalls: DEFAULTS.solver.maxToolCalls,
  maxDurationMs: DEFAULTS.solver.maxDurationMs,
  staleThreshold: DEFAULTS.antiLoop.staleThreshold,
  maxParallel: DEFAULTS.solver.maxParallel,
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




/**
 * Solve — single agent.stream() call per REPL turn.
 *
 * The agent starts with catalog discovery only. Activated native tools are
 * refreshed between model steps. Goal is the user message plus a bounded
 * deterministic runtime index.
 */
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

  // Wire EvidenceGate into writeFinding for Maker/Checker split
  const { setEvidenceGateForFindings } = await import("../tools/control-tools");
  setEvidenceGateForFindings(evidence);
  const emit = (event: PhaseEvent) => params.onPhase?.(event);
  const emitMessage = (message: SolverStreamMessage) => params.onMessage?.(message);
  const startTime = Date.now();

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
  }

  const capabilityRegistry = (agent as any).capabilityRegistry as DynamicToolRegistry | undefined;
  capabilityRegistry?.resetTurn();

  const contextRegistry = new ContextWindowRegistry(params.ultimatrixConfig ?? {} as UltimatrixConfig);
  const resolvedContextModel = params.ultimatrixConfig?.model
    ? resolveModelRef(params.ultimatrixConfig, { role: "brain" })
    : undefined;
  const contextModelId = [resolvedContextModel?.modelId, resolvedContextModel?.model, params.model]
    .find(modelId => modelId && contextRegistry.getContextWindow(modelId))
    ?? resolvedContextModel?.modelId
    ?? params.model
    ?? "";
  const contextWindow = contextRegistry.getContextWindow(contextModelId)
    || 128_000;
  if (resolvedContextModel) {
    emitMessage({
      kind: "event",
      event: "model.selected",
      label: `brain ${resolvedContextModel.provider}/${resolvedContextModel.model}`,
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
  let capturedRequestTotal = 0;
  try {
    capturedRequestTotal = getCapturedRequestStore().size;
  } catch {
    capturedRequestTotal = 0;
  }

  const runtimeEnvelope = buildRuntimeEnvelope({
    target: params.origin,
    contextWindow,
    graph: getGlobalGraphStore(),
    workflow: params.workflow,
    blackboard: board,
    alerts,
    blackboardFacts: { total: factStrings.length, recent: recentFacts },
    capturedRequests: { total: capturedRequestTotal },
  });
  let enrichedGoal = `${params.goal}${runtimeEnvelope}`;

  // Reflexion lessons + cross-engagement priors flow INTO the turn context
  // (previously pull-only). Both blocks are English prose designed for this.
  // Computed once; re-applied verbatim if a capability turn rebuilds the goal.
  const reflexionBlock = reflexion.toPromptBlock();
  const priorsBlock = params.priorsPromptBlock ?? (await loadPriorsBlock());
  const contextSuffix =
    (reflexionBlock ? `\n\n${reflexionBlock}` : "") +
    (priorsBlock ? `\n\n${priorsBlock}` : "");
  enrichedGoal += contextSuffix;

  // Inject stale detection context
  if (alerts.some(alert => alert.type === "stale-execution")) {
    emit({
      phase: "stale",
      step: 0,
      text: "Stale detection triggered — switching strategy",
    });
  }

  const caps = params.modelCapabilities ?? params.ultimatrixConfig?.modelCapabilities;
  const budgetPolicy = params.budgetPolicy;
  const registry = new ContextWindowRegistry(params.ultimatrixConfig ?? {} as any);
  const ctxManager = new ContextBudgetManager(caps ?? {}, registry);
    // Mastra Agent exposes instructions/tools via async accessors (getters were
    // removed). Resolve once for the context-budget estimate.
    let agentInstructions: string;
    try {
      agentInstructions = (await agent.getInstructions()) as string;
    } catch {
      agentInstructions = "";
    }
    let toolSchemasStr: string;
    try {
      const toolMap = await agent.listTools();
      toolSchemasStr = JSON.stringify(Object.fromEntries(Object.entries(toolMap).map(([id, tool]) => [id, (tool as any).inputSchema ?? null])));
    } catch {
      toolSchemasStr = "[]";
    }

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
    const ctxCheck = ctxManager.validateContextFit({
      modelId: contextModelId,
      systemPrompt: agentInstructions,
      toolSchemas: toolSchemasStr,
      conversationHistory,
      enrichedGoal,
      expectedOutputTokens: registry.getMaxOutput(contextModelId) || 2048,
    });

    // Log context validation
    log.dim(
      `[context] ${ctxCheck.totalInputTokens}/${ctxManager.getContextWindow(contextModelId)} tokens (${ctxCheck.severity})`,
    );
    emitMessage({
      kind: "event",
      event: "context.checked",
      label: `context ${ctxCheck.severity}: ${ctxCheck.totalInputTokens}/${ctxManager.getContextWindow(contextModelId) || contextWindow} tokens`,
      status: ctxCheck.severity === "critical" ? "error" : ctxCheck.severity === "warning" ? "warn" : "ok",
      data: {
        modelId: contextModelId,
        totalInputTokens: ctxCheck.totalInputTokens,
        availableForOutput: ctxCheck.availableForOutput,
        severity: ctxCheck.severity,
        fits: ctxCheck.fits,
      },
    });

    if (!ctxCheck.fits || ctxCheck.severity === "critical") {
      const enforcement = budgetPolicy?.enforcement ?? "soft";

      if (enforcement === "hard") {
        throw new Error(
          `Context overflow: ${ctxCheck.totalInputTokens} tokens exceeds model capacity. ` +
            `Suggestions: ${ctxCheck.suggestions.join("; ")}`,
        );
      }

      if (enforcement === "soft") {
        const truncated = ctxManager.truncateToFit({
          modelId: contextModelId,
          systemPrompt: agentInstructions,
          toolSchemas: toolSchemasStr,
          conversationHistory,
          enrichedGoal,
          expectedOutputTokens: registry.getMaxOutput(contextModelId) || 2048,
        });
        enrichedGoal = truncated.enrichedGoal;
        log.dim(
          `[context] Auto-truncated enriched goal to ${ctxManager.estimateTokens(enrichedGoal)} tokens`,
        );
      }
    }

  emit({ phase: "observe", step: 0, text: "" });

  let fullText = "";
  let streamIndex = 0;
  // Structured capture: answer (deliverable) vs reasoning (transient scratch).
  // Both channels (text-delta AND the canonical stream.text promise) feed `answerText` via appendDelta.
  let answerText = "";
  let reasoningText = "";
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let lastError: string | undefined;
  let ranCapabilityTurn = false;
  const timeoutSignal = AbortSignal.timeout(cfg.maxDurationMs);
  const streamSignal = params.signal
    ? AbortSignal.any([params.signal, timeoutSignal])
    : timeoutSignal;

  // Snapshot graph state for stale detection (compare before/after tool calls)
  const graphStateSnapshot = { findings: 0, endpoints: 0, tests: 0 };
  try {
    const graphStore = getGlobalGraphStore();
    const initialSummary = graphStore.getTargetSummary();
    graphStateSnapshot.findings = initialSummary.totalFindings;
    graphStateSnapshot.endpoints = initialSummary.totalEndpoints;
    graphStateSnapshot.tests = initialSummary.totalTests;
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

  try {
    const route = await decideTurnRoute(agent, {
      goal: params.goal,
      runtimeEnvelope,
      interactionMode: params.interactionMode,
      memory: params.memory,
      signal: streamSignal,
    });
    if (route.reasoning?.trim()) reasoningText = route.reasoning;
    if (route.kind === "direct") {
      answerText = route.response;
      if (route.response.trim()) emitMessage({ kind: "answer", text: route.response, index: streamIndex++ });
    }

    if (route.kind === "capability") {
    ranCapabilityTurn = true;
    enrichedGoal = `${params.goal}${runtimeEnvelope}${contextSuffix}`;

    const stream = await agent.stream(enrichedGoal, {
      maxSteps: cfg.maxToolCalls,
      ...(params.memory ? { memory: params.memory } : {}),
      abortSignal: streamSignal,
    });

    let lastToolCallArgs: Record<string, unknown> | undefined;
    const workerToolNames = new Set(["spawnWorker", "spawn-worker", "spawnSwarm", "spawn-swarm", "runTaskGraph", "run-task-graph"]);

    for await (const chunk of stream.fullStream) {
      if (streamSignal.aborted) {
        throw new Error(params.signal?.aborted
          ? "Solver interrupted"
          : `Solver timeout: ${cfg.maxDurationMs}ms exceeded`);
      }
      switch (chunk.type) {
        case "text-delta":
          fullText += chunk.payload.text;
          // Live answer channel: appendDelta deduplicates cumulative provider
          // chunks (nvidia sends full text each time) and passes through
          // incremental chunks (openai/anthropic) unchanged.
          answerText = appendDelta(answerText, chunk.payload.text);
          emitMessage({ kind: "answer", text: chunk.payload.text, index: streamIndex++ });
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
            lastToolCallArgs = chunk.payload.args as Record<string, unknown> | undefined;

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

            emitMessage({ kind: "tool-result", name: chunk.payload.toolName, ok: toolOk, result: output });
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

            // Track attack paths
            const detectedPath = extractAttackPath(output);
            if (detectedPath) {
              loopDetector.recordAttackPath(detectedPath);
            }

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

            // Update loop detector (stale tracking)
            loopDetector.recordRound(hasNewFinding);

            // Record failures in reflexion engine
            if (!toolOk) {
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
        ((stream as any).object ?? Promise.resolve(undefined)) as Promise<unknown>,
        stream.text as Promise<string | undefined>,
        stream.reasoningText as Promise<string | undefined>,
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
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Provide actionable error messages for common failures
    if (params.signal?.aborted) {
      lastError = 'Solver interrupted by user.';
    } else if (timeoutSignal.aborted) {
      lastError = `Solver timed out after ${cfg.maxDurationMs}ms. Increase solver.maxDurationMs in config.`;
    } else if (errMsg.includes('429') || errMsg.includes('rate limit') || errMsg.includes('Rate limited') || errMsg.includes('Quota exhausted')) {
      lastError = `Model rate limited or quota exhausted: ${errMsg}. Try switching provider/model in config.`;
    } else if (errMsg.includes('timeout') || errMsg.includes('Solver timeout')) {
      lastError = `Solver timed out: ${errMsg}. Increase solver.maxDurationMs in config.`;
    } else {
      lastError = `Solver error: ${errMsg}`;
    }
    log.error(lastError);
    forensicLog?.log({
      type: "error",
      agent: "solver-brain",
      error: lastError,
    });
  }

  let newFindings = 0;
  try {
    const currentSummary = getGlobalGraphStore().getTargetSummary();
    newFindings = Math.max(
      0,
      currentSummary.totalFindings - graphStateSnapshot.findings,
    );
  } catch {
    // Graph store not available
  }

  // Classify this turn from its own work, not findings persisted by older runs.
  const { completed, reason } = params.signal?.aborted
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
  const answerContent = visibleAssistantText(answerText).trim();
  const answerReasoning = reasoningText.trim();
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

  const answer: SolverAnswer = {
    content: answerContent,
    reasoning: answerReasoning,
    findings: findingRefs,
    planSummary: board.planSummary?.() || undefined,
    status: reason,
    completed,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    durationMs: Date.now() - startTime,
    steps: toolCallCount,
    toolCalls: toolCallCount,
    newFindings,
  };

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
  };
}

export {};
