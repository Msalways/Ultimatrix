// src/agents/agent-loop.ts
//
// The meta-orchestrator: a ReAct loop where the LLM is the loop body.
// Has only MANAGER primitives directly — everything else must be delegated
// to sub-agents via spawnAgent. This forces natural decomposition:
// the meta-orchestrator plans and delegates, sub-agents execute.
// No hardcoded techniques, strategies, or finding types.

import type { LLMClient, LLMCallResult } from '../llm/client';
import type { PrimitiveContext, PrimitiveName, PrimitiveResult } from '../primitives/types';
import type { AppModelFinding } from '../core/app-model';
import { executePrimitive } from './primitive-helpers';
import { emitFinding } from './finding';
import { runSubAgent } from './sub-agent';
import { buildMetaPrompt, buildMetaUserMessage } from './agent-prompts';
import { MANAGER_PRIMITIVES, MANAGER_TOOL_NAMES, schemasForToolNames } from './tool-schema';
import type { AgentTrace, SubAgentRun, AgentTurn } from './agent-trace';
import { TraceBuilder, summarizeTrace } from './agent-trace';
import { getGlobalRegistry } from '../plugins/registry';
import { registerBuiltins } from '../plugins/builtin';
import { createRecordingPlugin } from '../plugins/recording';

let pluginsInited = false;
function ensurePlugins(): void {
  if (pluginsInited) return;
  pluginsInited = true;
  registerBuiltins();
  getGlobalRegistry().registerPlugin(createRecordingPlugin());
}

export interface AgentLoopOptions {
  target: {
    url: string;
    method: string;
    params?: Array<{ name: string; type: string; required: boolean }>;
    bodyPreview?: string;
    headers?: Record<string, string>;
  };
  ctx: PrimitiveContext;
  llm: LLMClient;
  /** Max meta-orchestrator turns (default 15) */
  maxMetaTurns?: number;
  /** Max concurrent sub-agents (default 5) */
  maxConcurrentSubAgents?: number;
  /** Per-sub-agent max attempts (default 5) */
  maxSubAgentAttempts?: number;
  /** Optional sink for events (UI / trace) */
  onTrace?: (trace: AgentTrace) => void;
  onFinding?: (finding: AppModelFinding) => void;
  /** Optional sink for LLM token streaming (label, chunk). */
  onLLMToken?: (label: string, chunk: string) => void;
  /** Optional sink for per-primitive calls (Block 21). */
  onPrimitive?: (name: string, args: unknown, result: { ok: boolean; error?: string; durationMs: number }) => void;
  /** Free-form label for the trace */
  label?: string;
}

interface MetaAction {
  thought: string;
  tool: string;
  args: Record<string, unknown>;
}

const GIVEUP: MetaAction = { thought: '', tool: 'giveUp', args: {} };

function parseAction(text: string): MetaAction | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (typeof obj.tool === 'string' && typeof obj.thought === 'string') {
      return {
        thought: obj.thought,
        tool: obj.tool,
        args: (obj.args && typeof obj.args === 'object' ? obj.args : {}) as Record<string, unknown>,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export interface AgentLoopResult {
  trace: AgentTrace;
  findings: AppModelFinding[];
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  ensurePlugins();
  const maxMetaTurns = opts.maxMetaTurns ?? 15;
  const maxSubAgentAttempts = opts.maxSubAgentAttempts ?? 5;
  const builder = new TraceBuilder();
  const allFindings: AppModelFinding[] = [];
  const targetStr = formatTarget(opts.target);

  const systemPrompt = buildMetaPrompt(schemasForToolNames(MANAGER_TOOL_NAMES));

  for (let i = 0; i < maxMetaTurns; i++) {
    const turnStart = Date.now();

    const userMsg = buildMetaUserMessage({
      target: targetStr,
      turnIndex: i + 1,
      historySummary: summarizeTrace(builder.current()),
    });

    let action: MetaAction | null = null;
    try {
      // Block 21: stream the LLM call so the web UI / CLI see the agent
      // think in real time. If no onLLMToken is set, fall back to a
      // non-streaming `call()` so existing behavior (tests, mock LLM)
      // is unchanged. We always end up with a single LLMCallResult.
      const label = opts.label ? `${opts.label}/turn-${i + 1}` : `meta/turn-${i + 1}`;
      let res: LLMCallResult;
      if (opts.onLLMToken) {
        res = await opts.llm.stream(
          {
            system: systemPrompt,
            user: userMsg,
            label,
            temperature: 0.3,
          },
          (chunk) => opts.onLLMToken?.(label, chunk),
        );
      } else {
        res = await opts.llm.call({
          system: systemPrompt,
          user: userMsg,
          label,
          temperature: 0.3,
        });
      }
      action = parseAction(res.text);
    } catch (e) {
      const turn: AgentTurn = {
        turnIndex: i,
        thought: '(LLM call failed)',
        tool: 'giveUp',
        args: {},
        result: { ok: false, error: (e as Error).message, durationMs: Date.now() - turnStart },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        terminal: true,
        level: 'meta',
      };
      builder.addMetaTurn(turn);
      builder.setOutcome('error');
      break;
    }

    if (!action) {
      const turn: AgentTurn = {
        turnIndex: i,
        thought: '(could not parse action)',
        tool: 'giveUp',
        args: {},
        result: { ok: false, error: 'parse failed', durationMs: Date.now() - turnStart },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        terminal: true,
        level: 'meta',
      };
      builder.addMetaTurn(turn);
      builder.setOutcome('invalid');
      break;
    }

    // Stop on giveUp
    if (action.tool === 'giveUp' || action.tool === 'stop') {
      const turn: AgentTurn = {
        turnIndex: i,
        thought: action.thought,
        tool: action.tool,
        args: action.args,
        result: { ok: true, durationMs: 0 },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        terminal: true,
        level: 'meta',
      };
      builder.addMetaTurn(turn);
      builder.setOutcome(allFindings.length > 0 ? 'vulnerable' : 'clean');
      break;
    }

    // writeFinding: confirm via triage, append, continue
    if (action.tool === 'writeFinding') {
      opts.onPrimitive?.('writeFinding', action.args, { ok: true, durationMs: 0 });
      const { finding, triage } = await emitFinding(opts.ctx, action.args as never, opts.llm);
      const turn: AgentTurn = {
        turnIndex: i,
        thought: action.thought,
        tool: action.tool,
        args: action.args,
        result: {
          ok: !!finding,
          value: finding ? 'finding accepted' : `rejected: ${triage.reasoning}`,
          error: finding ? undefined : triage.reasoning,
          durationMs: Date.now() - turnStart,
        },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        level: 'meta',
      };
      builder.addMetaTurn(turn);
      if (finding) {
        allFindings.push(finding);
        builder.addFinding(finding);
        opts.onFinding?.(finding);
      }
      continue;
    }

    // spawnAgent: run a sub-agent. Collect specs and run in parallel.
    if (action.tool === 'spawnAgent') {
      const spec = action.args as {
        task: string;
        tools: string[];
        maxAttempts?: number;
        strategy?: string;
      };
      const subRun = await runSubAgent({
        id: `sub-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        task: String(spec.task ?? '(no task)'),
        tools: (spec.tools ?? []) as PrimitiveName[],
        strategy: spec.strategy,
        maxAttempts: spec.maxAttempts ?? maxSubAgentAttempts,
        target: targetStr,
        ctx: opts.ctx,
        llm: opts.llm,
        depth: 0,
        allowSpawn: true,
        onFinding: (f) => {
          allFindings.push(f);
          builder.addFinding(f);
          opts.onFinding?.(f);
        },
      });
      builder.addSubAgent(subRun);
      const turn: AgentTurn = {
        turnIndex: i,
        thought: action.thought,
        tool: action.tool,
        args: action.args,
        result: {
          ok: true,
          value: {
            outcome: subRun.outcome,
            findingsCount: subRun.findings.length,
            turnsCount: subRun.turns.length,
            observationsCount: subRun.observations.length,
            durationMs: subRun.durationMs,
            subSubAgents: subRun.subSubAgents.length,
            note: 'Full trace available in subAgents[]; see historySummary on next turn.',
          },
          durationMs: Date.now() - turnStart,
        },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        level: 'meta',
        observations: subRun.observations,
      };
      builder.addMetaTurn(turn);
      continue;
    }

    // Direct primitive call
    const turn = await executeMetaPrimitive(action, opts, builder, turnStart);
    // turn already added to builder inside executeMetaPrimitive
    void turn;
  }

  const trace = builder.finalize();
  if (trace.outcome === 'inconclusive') {
    trace.outcome = allFindings.length > 0 ? 'vulnerable' : 'clean';
  }
  opts.onTrace?.(trace);
  return { trace, findings: allFindings };
}

async function executeMetaPrimitive(
  action: MetaAction,
  opts: AgentLoopOptions,
  builder: TraceBuilder,
  turnStart: number,
): Promise<AgentTurn> {
  const validPrimitives: PrimitiveName[] = MANAGER_PRIMITIVES;

  if (!validPrimitives.includes(action.tool as PrimitiveName)) {
    const turn: AgentTurn = {
      turnIndex: builder.current().metaTurns.length,
      thought: action.thought,
      tool: action.tool,
      args: action.args,
      result: { ok: false, error: `unknown tool "${action.tool}"`, durationMs: Date.now() - turnStart },
      durationMs: Date.now() - turnStart,
      startedAt: turnStart,
      level: 'meta',
    };
    builder.addMetaTurn(turn);
    return turn;
  }

  let result: PrimitiveResult;
  try {
    // Block 21: forward onPrimitive from the agent loop's options so the
    // v4 event stream / HuntCore / web UI see every primitive call.
    // The helper itself owns the timing + error path now.
    result = await executePrimitive(
      action.tool as PrimitiveName,
      action.args,
      opts.ctx,
      opts.onPrimitive,
    );
  } catch (e) {
    result = { ok: false, error: (e as Error).message, durationMs: 0 };
  }

  const turn: AgentTurn = {
    turnIndex: builder.current().metaTurns.length,
    thought: action.thought,
    tool: action.tool,
    args: action.args,
    result: {
      ok: result.ok,
      value: result.value,
      error: result.error,
      durationMs: result.durationMs,
    },
    durationMs: Date.now() - turnStart,
    startedAt: turnStart,
    level: 'meta',
  };
  builder.addMetaTurn(turn);
  return turn;
}

function formatTarget(target: AgentLoopOptions['target']): string {
  const parts: string[] = [];
  parts.push(`URL: ${target.url}`);
  parts.push(`Method: ${target.method}`);
  if (target.params?.length) {
    parts.push(`Params: ${target.params.map((p) => `${p.name}(${p.type}${p.required ? ',required' : ''})`).join(', ')}`);
  }
  if (target.bodyPreview) {
    parts.push(`Body preview:\n${target.bodyPreview.slice(0, 1500)}`);
  }
  if (target.headers) {
    const h = Object.entries(target.headers).map(([k, v]) => `  ${k}: ${v}`).join('\n');
    parts.push(`Headers:\n${h}`);
  }
  return parts.join('\n\n');
}
