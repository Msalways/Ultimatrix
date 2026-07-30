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
import { getForensicLog } from "../tools/report-tools";
import { saveReflexionState } from "../intelligence/reflexion-store";
import { getGlobalGraphStore } from "../graph/store";
import { NodeType } from "../graph/schema";
import { DEFAULTS, CONTEXT_WINDOW_MAP, getConfig, type UltimatrixConfig } from "../config";
import { getGlobalUsageTracker } from "../usage/tracker";
import { ContextBudgetManager } from "../models/context-manager";
import { ContextWindowRegistry } from "../models/context-window-registry";
import { compactText } from "../output/compaction";

// Backward-compatible model→context mapping for models not in ModelCapabilities config
const FALLBACK_CONTEXT_WINDOW: Record<string, number> = CONTEXT_WINDOW_MAP;

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
      // Compact the overflowing section (head+tail) instead of a blind cut.
      const tokenBudget = Math.max(1, Math.floor(budget / 4));
      kept.push(compactText(section, { tokenBudget, strategy: "head-tail" }).text);
      budget = 0;
    }
  }

  return goalSection + kept.join("");
}

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
  /** @deprecated Use `answer.content`. Retained for back-compat; mirrors it. */
  text?: string;
  /** Structured final answer — the UI-facing source of truth. */
  answer?: SolverAnswer;
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
  ultimatrixConfig?: UltimatrixConfig;
  blackboard?: Blackboard;
  evidence?: EvidenceGate;
  loopDetector?: LoopDetector;
  reflexion?: ReflexionEngine;
  memory?: { thread: string; resource: string };
  onPhase?: (event: PhaseEvent) => void;
  /** Structured streaming output (preferred). Falls back to `onPhase` adapter if absent. */
  onMessage?: (message: SolverStreamMessage) => void;
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

const PRIMITIVE_TO_VULN_TYPE: Record<string, string> = {
  classicInjection: "sqli",
  secondOrderSqli: "sqli",
  nosqlInjection: "nosql-injection",
  sstiBlind: "ssti",
  ssrfMultiCloud: "ssrf",
  ssrfOast: "ssrf",
  authBypass: "auth-bypass",
  authzMatrix: "authz",
  idorSwapper: "idor",
  invariantProbe: "invariant-bypass",
  workflowBypass: "workflow-bypass",
  configTrust: "config-trust",
  ldapXpathInjection: "ldap-injection",
  rceClass: "rce",
  headerInjection: "header-injection",
  concurrencyHarness: "race-condition",
  aiTrust: "ai-prompt-injection",
};

let previousTurnSnapshot: { endpoints: number; findings: number; tests: number; authFlows: number; untestedActions: number } | undefined;

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

function extractVulnType(
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
): string {
  if (!toolName) return "";
  const upper = toolName.toUpperCase();
  if (upper === "RUNPRIMITIVE" && args) {
    const primitiveId = String(args.primitiveId ?? args.primitive ?? "");
    return PRIMITIVE_TO_VULN_TYPE[primitiveId] ?? primitiveId ?? "";
  }
  if (upper === "RUNCAMPAIGN" && args) {
    return String(args.technique ?? args.vulnType ?? "");
  }
  return "";
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
  bodyText: string,
  reasoningText: string,
): CompletionResult {
  const goalLower = (goal || "").toLowerCase();
  const isConversational =
    toolCallCount === 0 &&
    bodyText.length < 500 &&
    ["hi", "hello", "hey", "help", "ping", "test", "who", "what", "how"].some(
      (g) => goalLower.startsWith(g),
    );

  // Nothing happened at all (no deliverable answer and no reasoning)
  if (toolCallCount === 0 && bodyText.length === 0 && reasoningText.length === 0) {
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

  // ─── Auto campaign (Phase 2 / T2.6) ──────────────────────────────────
  // When config.engine === 'solver' AND config.campaign.auto is set, plan + run
  // a coverage campaign before the OODA loop, feeding confirmed findings into
  // the blackboard so the loop reasons over them. The loop still runs after.
  let autoCampaignFindings = 0;
  let previousCampaignPlan: import("../campaign/types").CampaignPlan | null = null;
  if (
    params.ultimatrixConfig?.engine === "solver" &&
    params.ultimatrixConfig.campaign?.auto
  ) {
    emit({ phase: "observe", step: 0, text: "[campaign] auto-planning coverage campaign..." });
    try {
      const { planCampaign } = await import("../campaign/planner");
      const { runCampaign } = await import("../campaign/executor");
      const { createPrimitiveRunner } = await import("../campaign/runner");
      const { listPrimitives } = await import("../primitives");
      const gate = new EvidenceGate();
      const { setEvidenceGateForFindings: setGate } = await import("../tools/control-tools");
      setGate(gate);
      const autoConfig = params.ultimatrixConfig;
      const executor = createPrimitiveRunner(
        getGlobalGraphStore(),
        autoConfig,
        gate,
      );
      const autoPlan = planCampaign(getGlobalGraphStore(), {
        primitives: listPrimitives().map((p) => ({
          id: p.id,
          description: p.description,
          tags: [],
        })),
        maxSlices: autoConfig.campaign?.maxSlices,
      });
      previousCampaignPlan = autoPlan;
      const autoResult = await runCampaign(autoPlan, {
        graphStore: getGlobalGraphStore(),
        config: autoConfig,
        executor,
        evidenceGate: gate,
        maxConcurrency: autoConfig.campaign?.maxConcurrency,
      });
      // Feed confirmed findings into the blackboard for the OODA loop to use.
      for (const f of autoResult.findings) {
        board.addFact(
          `Campaign confirmed: ${f.type} on ${f.endpoint} (${f.severity})`,
          "finding",
        );
      }
      autoCampaignFindings = autoResult.findings.length;
      log.dim(
        `[campaign] auto-run: ${autoResult.slicesRun} slices, ${autoResult.findings.length} findings`,
      );
    } catch (err) {
      log.warn(`[campaign] auto-run failed: ${(err as Error).message}`);
    }
  }

  // Auto-inject graph context + blackboard state into the goal message
  let enrichedGoal = params.goal;

  // Surface pre-confirmed campaign findings to the LLM strategist.
  if (autoCampaignFindings > 0) {
    const existing = getGlobalGraphStore().queryNodes?.(NodeType.FINDING) || [];
    const lines = existing
      .slice(-autoCampaignFindings)
      .map((n: any) => `- ${n.properties.type} on ${n.properties.endpoint} [${n.properties.severity}]`);
    if (lines.length > 0) {
      enrichedGoal +=
        `\n\n## Pre-confirmed Findings (Auto Campaign)\n` + lines.join("\n");
    }
  }

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

  // Inject recent discoveries (diff from previous turn's snapshot)
  try {
    const store = getGlobalGraphStore();
    const currentSummary = store.getTargetSummary();
    const config = getConfig()
    const maxPerLine = config.context?.maxFindingsPerTurn || 20

    if (previousTurnSnapshot) {
      const newEndpoints = currentSummary.totalEndpoints - previousTurnSnapshot.endpoints;
      const newFindings = currentSummary.totalFindings - previousTurnSnapshot.findings;
      const newTests = currentSummary.totalTests - previousTurnSnapshot.tests;
      const newAuthFlows = currentSummary.authFlows - previousTurnSnapshot.authFlows;
      const newUntested = currentSummary.untestedActions - previousTurnSnapshot.untestedActions;
      if (newEndpoints > 0 || newFindings > 0 || newTests > 0 || newAuthFlows > 0) {
        const discoveries: string[] = [];
        if (newEndpoints > 0) discoveries.push(`- New endpoints: ${newEndpoints}`);
        if (newFindings > 0) {
          // Only take last maxPerLine findings (not ALL new findings)
          const newFindingNodes = (store.queryNodes(NodeType.FINDING) as any[])
            .slice(-newFindings)
            .slice(-maxPerLine)

          const findingText = newFindingNodes.map((n: any) =>
            n.properties.technique + ' on ' + n.properties.endpoint + ' [' + n.properties.severity + ']'
          ).join(', ')

          discoveries.push(`- New findings: ${newFindings} (${findingText})`)

          // If there are more findings than maxPerLine, add a note
          if (newFindings > maxPerLine) {
            const remaining = newFindings - maxPerLine
            discoveries.push(`  - ... and ${remaining} more findings (not shown)`)
          }
        }
        if (newTests > 0) discoveries.push(`- New tests: ${newTests}`);
        if (newAuthFlows > 0) discoveries.push(`- New auth flows: ${newAuthFlows}`);
        if (newUntested > 0) discoveries.push(`- New untested actions: ${newUntested}`);
        enrichedGoal += `\n\n## Recent Discoveries (since last turn)\n${discoveries.join('\n')}`;
      }
    }
    previousTurnSnapshot = {
      endpoints: currentSummary.totalEndpoints,
      findings: currentSummary.totalFindings,
      tests: currentSummary.totalTests,
      authFlows: currentSummary.authFlows,
      untestedActions: currentSummary.untestedActions,
    };
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

  // Inject cross-engagement priors (anonymized patterns from past engagements)
  try {
    const { CrossEngagementMemory } = await import('../intelligence/cross-engagement')
    const mem = new CrossEngagementMemory()
    await mem.load()
    const priors = mem.getPriorPatterns()
    if (priors.engagementCount > 0) {
      enrichedGoal += `\n\n${priors.promptBlock}`
    }
  } catch {
    // Cross-engagement memory not available
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
    const reflectionPrompt = reflexion.toReflectionPrompt();
    if (reflectionPrompt) {
      enrichedGoal += `\n\n${reflectionPrompt}`;
    }
    const escalationLevel = reflexion.getEscalationLevel();
    if (escalationLevel >= 3) {
      const hints = reflexion.getEscalationHints();
      if (hints.length > 0) {
        enrichedGoal += `\n\n## L${escalationLevel} Escalation — Mandatory Strategy Switch`;
        enrichedGoal += `\nYou MUST switch to a different vulnerability class or attack surface. Do not retry the same approach.`;
        enrichedGoal += `\nBypass hints:\n${hints.map((h) => `- ${h}`).join("\n")}`;
      }
    }
  }

  // Truncate enriched goal to fit model context budget
  // If ModelCapabilities are provided, use ContextBudgetManager for smarter truncation
  const caps = params.modelCapabilities;
  const budgetPolicy = params.budgetPolicy;
  const registry = new ContextWindowRegistry(params.ultimatrixConfig ?? {} as any);

  // Registry-based lookup: modelCapabilities → null
  const hasModelConfig = params.model && registry.getContextWindow(params.model) > 0;

  if (hasModelConfig) {
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
      toolSchemasStr = JSON.stringify(Object.keys(toolMap || {}));
    } catch {
      toolSchemasStr = "[]";
    }

    const ctxCheck = ctxManager.validateContextFit({
      modelId: params.model ?? "",
      systemPrompt: agentInstructions,
      toolSchemas: toolSchemasStr,
      conversationHistory: "",
      enrichedGoal,
    });

    // Log context validation
    log.dim(
      `[context] ${ctxCheck.totalInputTokens}/${ctxManager.getContextWindow(params.model ?? "")} tokens (${ctxCheck.severity})`,
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
          modelId: params.model ?? "",
          systemPrompt: agentInstructions,
          toolSchemas: toolSchemasStr,
          conversationHistory: "",
          enrichedGoal,
        });
        enrichedGoal = truncated.enrichedGoal;
        log.dim(
          `[context] Auto-truncated enriched goal to ${ctxManager.estimateTokens(enrichedGoal)} tokens`,
        );
      }
      // 'warn' — just log; the ContextBudgetManager path owns sizing, so we do
      // NOT run the legacy truncateEnrichedGoal again (would double-slice).
    }
  } else {
    // No ModelCapabilities configured — use legacy cap (now CONTEXT_WINDOW_MAP-backed)
    const goalCap = getEnrichedGoalCap(params.model);
    enrichedGoal = truncateEnrichedGoal(enrichedGoal, params.goal, goalCap);
  }

  emit({ phase: "observe", step: 0, text: "" });

  let fullText = "";
  let streamIndex = 0;
  // Structured capture: answer (deliverable) vs reasoning (transient scratch).
  // Both channels (text-delta AND the canonical stream.text promise) feed `answerParts`.
  const answerParts: string[] = [];
  const reasoningParts: string[] = [];
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

    let lastToolCallArgs: Record<string, unknown> | undefined;
    let lastToolCallName: string | undefined;

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          fullText += chunk.payload.text;
          // Live answer channel: streamed deltas are for TRANSIENT display only.
          // The committed deliverable is resolved from the SDK-canonical
          // `stream.text` promise after the loop (see final-answer resolution
          // below) — provider-normalized for every backend, so no provider
          // specific folding is needed here.
          answerParts.push(chunk.payload.text);
          emitMessage({ kind: "answer", text: chunk.payload.text, index: streamIndex++ });
          emit({
            phase: "reason",
            step: toolCallCount,
            text: chunk.payload.text,
            reasoning: false,
          });
          break;

        case "reasoning-delta":
          if (chunk.payload.text) {
            // Transient scratch: captured for the structured `answer.reasoning`
            // field and shown live, never treated as the deliverable.
            reasoningParts.push(chunk.payload.text);
            emitMessage({ kind: "reasoning", text: chunk.payload.text, index: streamIndex++ });
            emit({
              phase: "reason",
              step: toolCallCount,
              text: chunk.payload.text,
              reasoning: true,
            });
          }
          break;

        case "tool-call":
          if (chunk.payload.toolName && chunk.payload.toolName !== "askUser") {
            toolCallCount++;
            lastToolCallName = chunk.payload.toolName;
            lastToolCallArgs = chunk.payload.args as Record<string, unknown> | undefined;

            emit({
              phase: detectPhase(chunk.payload.toolName),
              step: toolCallCount,
              toolName: chunk.payload.toolName,
              toolArgs: chunk.payload.args,
            });
            emitMessage({
              kind: "tool",
              name: chunk.payload.toolName,
              args: chunk.payload.args as Record<string, unknown> | undefined,
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

            emitMessage({ kind: "tool-result", name: chunk.payload.toolName, ok: true, result: output });

            // Track attack paths
            const detectedPath = extractAttackPath(output);
            if (detectedPath) {
              loopDetector.recordAttackPath(detectedPath);
            }

            // Determine if this tool call produced graph changes (not just tool name substring)
            let hasNewFinding = false;
            let hasNewEndpoints = false;
            try {
              const graphAfter = getGlobalGraphStore();
              const summaryAfter = graphAfter.getTargetSummary();
              if (summaryAfter.totalFindings > graphStateSnapshot.findings ||
                  summaryAfter.totalEndpoints > graphStateSnapshot.endpoints ||
                  summaryAfter.totalTests > graphStateSnapshot.tests) {
                hasNewFinding = true;
              }
              if (summaryAfter.totalEndpoints > graphStateSnapshot.endpoints) {
                hasNewEndpoints = true;
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

            // Re-plan campaign when new endpoints discovered mid-loop
            if (hasNewEndpoints && params.ultimatrixConfig?.campaign?.auto && previousCampaignPlan) {
              try {
                const { replanCampaign } = await import("../campaign/planner");
                const { listPrimitives } = await import("../primitives");
                const freshPlan = replanCampaign(
                  getGlobalGraphStore(),
                  previousCampaignPlan,
                  {
                    primitives: listPrimitives().map(p => ({ id: p.id, description: p.description, tags: [] })),
                    maxSlices: params.ultimatrixConfig.campaign?.maxSlices,
                  },
                );
                if (freshPlan.slices.length > 0) {
                  board.addFact(`Campaign re-planned: ${freshPlan.slices.length} new slices for newly discovered endpoints`, "campaign");
                  emit({ phase: "observe", step: toolCallCount, text: `[campaign] re-planned: ${freshPlan.slices.length} new slices for ${freshPlan.slices.length} new endpoints` });
                  previousCampaignPlan = { slices: [...previousCampaignPlan.slices, ...freshPlan.slices], coverage: freshPlan.coverage, generatedAt: Date.now(), options: freshPlan.options };
                }
              } catch (err) {
                log.warn(`[campaign] re-plan failed: ${(err as Error).message}`);
              }
            }

            // Record failures in reflexion engine
            if (
              chunk.payload.result &&
              typeof chunk.payload.result === "object"
            ) {
              const result = chunk.payload.result as any;
              if (result.error || result.status === "failed") {
                const vulnType = extractVulnType(lastToolCallName, lastToolCallArgs);
                reflexion.recordAttempt(
                  chunk.payload.toolName,
                  false,
                  null,
                  result.error || String(result),
                  vulnType,
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
              const vulnType = extractVulnType(lastToolCallName, lastToolCallArgs);
              reflexion.recordAttempt(
                chunk.payload.toolName,
                false,
                null,
                chunk.payload.error instanceof Error ? chunk.payload.error.message : String(chunk.payload.error ?? ""),
                vulnType,
              );

            // Record error in loop detector (counts as no progress)
            loopDetector.recordRound(false);

            forensicLog?.log({
              type: "tool-error",
              agent: "solver-brain",
              tool: chunk.payload.toolName,
              error: chunk.payload.error instanceof Error ? chunk.payload.error.message : String(chunk.payload.error ?? ""),
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
      const resolvedText = (await stream.text) as string | undefined;
      if (resolvedText && resolvedText.trim().length > 0) {
        canonicalAnswer = resolvedText;
      }
      const resolvedReasoning = (await stream.reasoningText) as string | undefined;
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
      answerParts.length = 0;
      answerParts.push(canonicalAnswer);
    }
    // Commit the canonical reasoning. When present it supersedes the raw
    // reasoning-delta chunks; otherwise keep what was captured live.
    if (canonicalReasoning) {
      reasoningParts.length = 0;
      reasoningParts.push(canonicalReasoning);
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
    answerParts.join(""),
    reasoningParts.join(""),
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

  // ─── Exploitation loop (weaponization spine) ───────────────────────
  // Single escalation driver: after a finding lands, build exploit proofs,
  // capture impact, reuse held sessions to pivot within scope, then emit a
  // deliverable report. Driven by the typed ExploitationTracker agenda
  // (which folds in relation-seeded chain proposals). Bounded by
  // maxActiveChainSteps so it never hijacks the turn's budget.
  if (
    params.ultimatrixConfig?.engine === "solver" ||
    params.ultimatrixConfig?.engine === "multi-model"
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
  const answerContent = answerParts.join("").trim();
  const answerReasoning = reasoningParts.join("").trim();
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
  };

  emitMessage({ kind: "done", answer });

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
    text: answerContent || fullText || undefined,
    answer,
    error: lastError || undefined,
  };
}

export {};
