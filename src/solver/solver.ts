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
 * The agent arrives fully wired (via createSolverBrain → createAgent).
 * No instruction or tool overrides here. Goal is the user message.
 */

import type { Agent } from "@mastra/core/agent";
import { Blackboard } from "./blackboard";
import { EvidenceGate } from "../intelligence/evidence-gate";
import { ReflexionEngine } from "../intelligence/reflexion";
import { LoopDetector, extractAttackPath } from "../intelligence/anti-loop";
import { log } from "../utils/logger";
import { setForensicLog } from "../tools/report-tools";
import { saveReflexionState } from "../intelligence/reflexion-store";
import { getGlobalGraphStore } from "../graph/store";
import { NodeType } from "../graph/schema";
import { DEFAULTS } from "../config";
import { getGlobalUsageTracker } from "../usage/tracker";
import { ContextBudgetManager } from "../models/context-manager";

// Backward-compatible model→context mapping for models not in ModelCapabilities config
const FALLBACK_CONTEXT_WINDOW: Record<string, number> = {
  "groq/llama3-8b-8192": 8192,
  "openai/gpt-4o": 128000,
  "openai/gpt-4o-mini": 128000,
  "anthropic/claude-3-5-sonnet": 200000,
  "anthropic/claude-3-haiku": 200000,
  "google/gemini-2.0-flash": 1048576,
  "nvidia/nemotron-ultra-253b": 131072,
};

function getEnrichedGoalCap(model?: string): number {
  if (!model) return 8000;
  const ctx = FALLBACK_CONTEXT_WINDOW[model];
  if (!ctx) return 8000;
  if (ctx <= 8192) return 4000;
  if (ctx <= 32000) return 8000;
  if (ctx <= 131072) return 16000;
  return 32000;
}

/**
 * Truncate enriched goal to fit within model context budget.
 * Preserves user's original goal. Trims injected context from least to most important.
 */
function truncateEnrichedGoal(
  full: string,
  originalGoal: string,
  maxChars: number,
): string {
  if (full.length <= maxChars) return full;

  // Strategy: keep original goal + truncate injected sections
  const sections = full.split(/(?=^## )/m);
  const goalSection = sections[0]; // user's original goal (first section before any ## header)
  const injectedSections = sections.slice(1);

  if (goalSection.length >= maxChars) {
    return goalSection.slice(0, maxChars) + "\n... [truncated]";
  }

  let budget = maxChars - goalSection.length;
  const kept: string[] = [];

  // Priority order (keep most important first): stale/hallucination warnings > graph state > blackboard > reflexion hints
  const priorityOrder = [
    "WARNING",
    "Current Graph State",
    "Accumulated Knowledge",
    "Lessons from Past",
    "Captured Traffic",
  ];
  const sorted: string[] = [];

  for (const keyword of priorityOrder) {
    const idx = injectedSections.findIndex((s) => s.includes(keyword));
    if (idx >= 0) {
      sorted.push(injectedSections[idx]);
      injectedSections.splice(idx, 1);
    }
  }
  // Add remaining sections in original order
  sorted.push(...injectedSections);

  for (const section of sorted) {
    if (budget <= 0) break;
    if (section.length <= budget) {
      kept.push(section);
      budget -= section.length;
    } else {
      kept.push(section.slice(0, budget) + "\n... [truncated]");
      budget = 0;
    }
  }

  return goalSection + kept.join("");
}

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
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  progress?: {
    endpoints: number;
    findings: number;
    tested: number;
    pending: number;
  };
  interruptPrompt?: string;
}

export interface SolveResult {
  completed: boolean;
  reason:
    | "goal_achieved"
    | "frontier_exhausted"
    | "budget_reached"
    | "stale"
    | "interrupted";
  steps: number;
  toolCalls: number;
  tokensUsed: number;
  durationMs: number;
  facts: number;
  intents: number;
  planSummary?: string;
  text?: string;
  error?: string;
}

export interface SolveParams {
  origin: string;
  goal: string;
  hints?: string[];
  matchedSkills?: Array<{
    id: string;
    name: string;
    description: string;
    instructions?: string;
    toolChains?: Array<{ name: string; description: string; steps: string[] }>;
    compositionRules?: { requires?: string[]; enhances?: string[]; conflicts?: string[] };
  }>;
  model?: string;
  config?: SolverConfig;
  blackboard?: Blackboard;
  evidence?: EvidenceGate;
  loopDetector?: LoopDetector;
  reflexion?: ReflexionEngine;
  memory?: { thread: string; resource: string };
  onPhase?: (event: PhaseEvent) => void;
  onToolComplete?: (toolName: string, result?: unknown) => void;
  modelCapabilities?: import("../config").ModelCapabilities;
  budgetPolicy?: import("../config").BudgetPolicy;
}

const SOLVER_DEFAULTS: Required<SolverConfig> = {
  maxToolCalls: DEFAULTS.solver.maxToolCalls,
  maxDurationMs: DEFAULTS.solver.maxDurationMs,
  staleThreshold: DEFAULTS.antiLoop.staleThreshold,
  maxParallel: DEFAULTS.solver.maxParallel,
};

function detectPhase(toolName?: string): SolverPhase {
  if (!toolName) return "reason";

  const upper = toolName.toUpperCase();

  if (
    [
      "GETTARGETSUMMARY",
      "QUERYGRAPH",
      "GETENDPOINTSWITHPARAMS",
      "GETFULLCONTEXT",
    ].includes(upper)
  ) {
    return "observe";
  }
  if (
    ["SKILLSEARCH", "SKILLLOAD", "SEARCHSKILLS", "LOADSKILLREFERENCE"].includes(
      upper,
    )
  ) {
    return "learn";
  }
  if (
    [
      "SPAWNWORKER",
      "SPAWNSWARM",
      "EXECUTEDIRECT",
      "HTTPREQUEST",
      "STAGEHAND_NAVIGATE",
      "STAGEHAND_ACT",
    ].includes(upper)
  ) {
    return "attack";
  }
  if (["WRITEFINDING", "RECORDEVIDENCE", "UPDATEGRAPH"].includes(upper)) {
    return "record";
  }

  return "reason";
}

interface CompletionResult {
  completed: boolean;
  reason: SolveResult["reason"];
}

/**
 * Determine completion based on graph findings and conversation state.
 *
 * - Graph findings exist → goal_achieved
 * - Conversational turn (hi, hello) → frontier_exhausted (normal)
 * - Nothing happened → stale
 */
function checkCompletion(
  goal: string,
  toolCallCount: number,
  fullText: string,
): CompletionResult {
  const goalLower = (goal || "").toLowerCase();
  const isConversational =
    toolCallCount === 0 &&
    fullText.length < 500 &&
    ["hi", "hello", "hey", "help", "ping", "test", "who", "what", "how"].some(
      (g) => goalLower.startsWith(g),
    );

  // Nothing happened at all
  if (toolCallCount === 0 && fullText.length === 0) {
    return { completed: false, reason: "stale" };
  }

  // Conversational turn — just show response, no completion forced
  if (isConversational) {
    return { completed: false, reason: "frontier_exhausted" };
  }

  // Check if the agent wrote findings to the graph
  try {
    const store = getGlobalGraphStore();
    const findings = store.queryNodes?.(NodeType.FINDING) || [];
    if (findings.length > 0) {
      return { completed: true, reason: "goal_achieved" };
    }
  } catch {
    // Graph store not available
  }

  // Agent responded but no findings — normal turn
  return { completed: false, reason: "frontier_exhausted" };
}

/**
 * Solve — single agent.stream() call per REPL turn.
 *
 * The agent arrives fully wired (all tools, browser, instructions).
 * Goal is the user message. Intelligence layers observe passively.
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
  const forensicLog = setForensicLog();

  // Wire EvidenceGate into writeFinding for Maker/Checker split
  const { setEvidenceGateForFindings } = await import("../tools/control-tools");
  setEvidenceGateForFindings(evidence);
  const emit = (event: PhaseEvent) => params.onPhase?.(event);
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

  // Auto-inject graph context + blackboard state into the goal message
  let enrichedGoal = params.goal;

  try {
    const store = getGlobalGraphStore();
    const summary = store.getTargetSummary();
    if (summary.totalEndpoints > 0 || summary.totalFindings > 0) {
      const graphContext = [
        `\n\n## Current Graph State`,
        `- ${summary.totalEndpoints} endpoints discovered (${summary.totalCapturedHeaders} with captured headers)`,
        `- ${summary.totalFindings} findings: ${
          Object.entries(summary.findingsBySeverity)
            .map(([s, c]) => `${s}=${c}`)
            .join(", ") || "none"
        }`,
        `- ${summary.totalTests} tests run`,
        `- ${summary.authFlows} auth flows, ${summary.rbacRoles} RBAC roles`,
        `- ${summary.untestedActions} untested actions`,
      ];
      if (summary.endpoints.length > 0) {
        graphContext.push("Top endpoints:");
        for (const ep of summary.endpoints.slice(0, 10)) {
          graphContext.push(
            `  - ${ep.method} ${ep.url} (params: ${ep.params}, auth: ${ep.authRequired ? "yes" : "no"}, headers: ${ep.headerCount})`,
          );
        }
      }
      enrichedGoal += "\n" + graphContext.join("\n");
    }
  } catch {
    // Graph store not available
  }

  // Inject blackboard state (accumulated across REPL turns)
  const boardState = board.toPromptGraph();
  if (boardState && board.facts.length > 1) {
    enrichedGoal += `\n\n## Accumulated Knowledge (Blackboard)\n\`\`\`\n${boardState}\n\`\`\``;
  }

  // Inject reflexion hints from past sessions (target-scoped)
  try {
    const { loadRelevantHints } =
      await import("../intelligence/reflexion-store");
    const hints = loadRelevantHints("", params.origin);
    if (hints.length > 0) {
      enrichedGoal += `\n\n## Lessons from Past Sessions\n${hints.map((h) => `- ${h}`).join("\n")}`;
    }
  } catch {
    // Reflexion store not available
  }

  // Inject matched skill methodology (from per-message skill matching)
  if (params.matchedSkills && params.matchedSkills.length > 0) {
    const skillBlock = params.matchedSkills
      .map((s) => {
        let block = s.instructions
          ? `### ${s.name}\n${s.instructions}`
          : `### ${s.name}\n${s.description}`;

        // Inject tool chain guidance if available
        if (s.toolChains && s.toolChains.length > 0) {
          const chainBlock = s.toolChains
            .map(c => `#### ${c.name}: ${c.description}\nSteps: ${c.steps.join(' → ')}`)
            .join('\n');
          block += `\n\n**Recommended Tool Chains:**\n${chainBlock}`;
        }

        // Inject composition hints if available
        if (s.compositionRules) {
          const comp = s.compositionRules;
          if (comp.requires?.length) {
            block += `\n**Prerequisites:** Load ${comp.requires.join(', ')} first`;
          }
          if (comp.enhances?.length) {
            block += `\n**Enhances:** Combine with ${comp.enhances.join(', ')} for complete coverage`;
          }
        }

        return block;
      })
      .join("\n\n");
    enrichedGoal += `\n\n## Relevant Methodology\n\n${skillBlock}`;
  }

  // Inject stale detection context
  if (loopDetector.isStale(cfg.staleThreshold)) {
    enrichedGoal += `\n\n## WARNING: Stale detection triggered`;
    enrichedGoal += `\nThe agent has repeated the same attack path ${cfg.staleThreshold} times.`;
    enrichedGoal += `\nSwitch strategy immediately. Try a completely different approach or ask the user for guidance.`;
    emit({
      phase: "stale",
      step: 0,
      text: "Stale detection triggered — switching strategy",
    });
  }

  // Inject hallucination warnings from evidence gate
  const unsupported = evidence.getUnsupportedClaims?.();
  if (unsupported && unsupported.length > 0) {
    enrichedGoal += `\n\n## WARNING: Hallucinated claims detected`;
    enrichedGoal += `\nThe agent previously claimed things without tool evidence. VERIFY all claims with tools before reporting.`;
    for (const claim of unsupported.slice(0, 5)) {
      enrichedGoal += `\n- Unsupported: "${claim}"`;
    }
  }

  // Inject reflexion strategy suggestions (if any failures recorded)
  if (reflexion.shouldReflect()) {
    const reflexionBlock = reflexion.toPromptBlock();
    if (reflexionBlock) {
      enrichedGoal += `\n\n## Strategy Adjustment\n${reflexionBlock}`;
    }
  }

  // Truncate enriched goal to fit model context budget
  // If ModelCapabilities are provided, use ContextBudgetManager for smarter truncation
  const caps = params.modelCapabilities;
  const budgetPolicy = params.budgetPolicy;

  if (caps && params.model && caps[params.model]) {
    const ctxManager = new ContextBudgetManager(caps);
    const toolSchemasStr =
      typeof agent.tools === "object"
        ? JSON.stringify(Object.keys(agent.tools || {}))
        : "[]";

    const ctxCheck = ctxManager.validateContextFit({
      modelId: params.model,
      systemPrompt: agent.instructions || "",
      toolSchemas: toolSchemasStr,
      conversationHistory: "",
      enrichedGoal,
    });

    // Log context validation
    log.dim(
      `[context] ${ctxCheck.totalInputTokens}/${ctxManager.getContextWindow(params.model)} tokens (${ctxCheck.severity})`,
    );

    if (ctxCheck.severity === "critical") {
      const enforcement = budgetPolicy?.enforcement ?? "soft";

      if (enforcement === "hard") {
        throw new Error(
          `Context overflow: ${ctxCheck.totalInputTokens} tokens exceeds model capacity. ` +
            `Suggestions: ${ctxCheck.suggestions.join("; ")}`,
        );
      }

      if (enforcement === "soft") {
        const truncated = ctxManager.truncateToFit({
          modelId: params.model,
          systemPrompt: agent.instructions || "",
          toolSchemas: toolSchemasStr,
          conversationHistory: "",
          enrichedGoal,
        });
        enrichedGoal = truncated.enrichedGoal;
        log.dim(
          `[context] Auto-truncated enriched goal to ${ctxManager.estimateTokens(enrichedGoal)} tokens`,
        );
      }
      // 'warn' — just log, fall through to legacy truncation
    }

    // Always ensure basic cap (legacy fallback for models without full caps)
    const goalCap = getEnrichedGoalCap(params.model);
    enrichedGoal = truncateEnrichedGoal(enrichedGoal, params.goal, goalCap);
  } else {
    // No ModelCapabilities configured — use legacy cap
    const goalCap = getEnrichedGoalCap(params.model);
    enrichedGoal = truncateEnrichedGoal(enrichedGoal, params.goal, goalCap);
  }

  emit({ phase: "observe", step: 0, text: "" });

  let fullText = "";
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let lastError: string | undefined;

  // Snapshot graph state for stale detection (compare before/after tool calls)
  const graphStateSnapshot = { findings: 0, endpoints: 0, tests: 0 };
  try {
    const graphStore = getGlobalGraphStore();
    const initialSummary = graphStore.getTargetSummary();
    graphStateSnapshot.findings = initialSummary.totalFindings;
    graphStateSnapshot.endpoints = initialSummary.totalEndpoints;
    graphStateSnapshot.tests = initialSummary.totalTests;
  } catch {
    // Graph store not available
  }

  try {
    // Single stream call — Mastra handles tool loops internally (like v7)
    // Wrap with timeout enforcement via maxDurationMs
    const streamPromise = agent.stream(enrichedGoal, {
      maxSteps: cfg.maxToolCalls,
      ...(params.memory ? { memory: params.memory } : {}),
    });

    const timeoutMs = cfg.maxDurationMs;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Solver timeout: ${timeoutMs}ms exceeded`)),
        timeoutMs,
      );
    });

    const stream = await Promise.race([streamPromise, timeoutPromise]);

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          fullText += chunk.payload.text;
          emit({
            phase: "reason",
            step: toolCallCount,
            text: chunk.payload.text,
          });
          break;

        case "reasoning-delta":
          if (chunk.payload.text) {
            fullText += chunk.payload.text;
            emit({
              phase: "reason",
              step: toolCallCount,
              text: chunk.payload.text,
            });
          }
          break;

        case "tool-call":
          if (chunk.payload.toolName && chunk.payload.toolName !== "askUser") {
            toolCallCount++;

            emit({
              phase: detectPhase(chunk.payload.toolName),
              step: toolCallCount,
              toolName: chunk.payload.toolName,
              toolArgs: chunk.payload.args,
            });
          }
          break;

        case "tool-result":
          if (chunk.payload.toolName) {
            const output =
              typeof chunk.payload.result === "string"
                ? chunk.payload.result
                : JSON.stringify(chunk.payload.result);

            // Record tool output in evidence gate
            evidence.recordToolOutput(output);

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
            if (
              chunk.payload.result &&
              typeof chunk.payload.result === "object"
            ) {
              const result = chunk.payload.result as any;
              if (result.error || result.status === "failed") {
                reflexion.recordAttempt(
                  chunk.payload.toolName,
                  false,
                  null,
                  result.error || String(result),
                  "",
                );
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
            log.error(
              `${chunk.payload.toolName} failed: ${chunk.payload.error}`,
            );

            // Record failure in reflexion engine
            reflexion.recordAttempt(
              chunk.payload.toolName,
              false,
              null,
              chunk.payload.error,
              "",
            );

            // Record error in loop detector (counts as no progress)
            loopDetector.recordRound(false);

            forensicLog?.log({
              type: "tool-error",
              agent: "solver-brain",
              tool: chunk.payload.toolName,
              error: chunk.payload.error,
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
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Provide actionable error messages for common failures
    if (errMsg.includes('429') || errMsg.includes('rate limit') || errMsg.includes('Rate limited') || errMsg.includes('Quota exhausted')) {
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

  // Check goal completion based on graph findings
  const { completed, reason } = checkCompletion(
    params.goal,
    toolCallCount,
    fullText,
  );

  // Persist reflexion state for future sessions
  if (params.reflexion && params.reflexion.getAttemptCount() > 0) {
    try {
      saveReflexionState(params.reflexion, "solver-brain", params.origin);
    } catch {}
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

  return {
    completed,
    reason,
    steps: toolCallCount,
    toolCalls: toolCallCount,
    tokensUsed: totalTokens || fullText.length,
    durationMs: Date.now() - startTime,
    facts: board.facts?.length || 0,
    intents: board.intents?.length || 0,
    planSummary: board.planSummary?.() || "",
    text: fullText || undefined,
    error: lastError || undefined,
  };
}

export {};
