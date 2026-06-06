// src/agents/sub-agent.ts
//
// A focused sub-agent: a ReAct loop with a chosen tool subset, a free-form
// task, and a free-form strategy. Spawned by the meta-orchestrator at
// runtime. The LLM is the loop body.
//
// The sub-agent has its own LLM context (system prompt + messages), runs
// primitives in turn, and reports findings + observations back to the
// meta-orchestrator via callbacks. No hardcoded techniques — the LLM is
// free to explore.

import type { LLMClient, LLMCallResult } from '../llm/client';
import type { PrimitiveContext, PrimitiveName, PrimitiveResult } from '../primitives/types';
import type { AppModelFinding } from '../core/app-model';
import { executePrimitive } from './primitive-helpers';
import { emitFinding } from './finding';
import { buildSubAgentPrompt } from './agent-prompts';
import { schemasForToolNames } from './tool-schema';
import type { SubAgentRun, AgentTurn } from './agent-trace';

export interface SubAgentOptions {
  id: string;
  task: string;
  tools: PrimitiveName[];
  strategy?: string;
  maxAttempts?: number;
  target: string;
  ctx: PrimitiveContext;
  llm: LLMClient;
  /** Called when a finding is emitted (after triage confirmation) */
  onFinding?: (finding: AppModelFinding) => void;
  /** Called when the LLM makes an interesting observation (free-form text) */
  onObservation?: (observation: string) => void;
}

export interface SubAgentAction {
  thought: string;
  tool: string;
  args: Record<string, unknown>;
}

interface ParsedAction extends SubAgentAction {}

const GIVEUP_ACTION: ParsedAction = { thought: '', tool: 'giveUp', args: {} };

function parseAction(text: string): ParsedAction | null {
  // Find a JSON object in the response
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

export async function runSubAgent(opts: SubAgentOptions): Promise<SubAgentRun> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const startedAt = Date.now();
  const turns: AgentTurn[] = [];
  const findings: AppModelFinding[] = [];
  const observations: string[] = [];
  let outcome: SubAgentRun['outcome'] = 'inconclusive';
  let consecutiveErrors = 0;

  const toolSchemas = schemasForToolNames(opts.tools as string[]);
  const systemPrompt = buildSubAgentPrompt({
    task: opts.task,
    target: opts.target,
    strategy: opts.strategy ?? '',
    toolSchemas,
    maxAttempts,
  });

  for (let i = 0; i < maxAttempts; i++) {
    const turnStart = Date.now();
    const historySummary = summarizeOwnTurns(turns, findings);

    const userMsg = `# Turn ${i + 1} / ${maxAttempts}\n${historySummary}\n\nWhat is your next tool call?`;

    let action: ParsedAction | null = null;
    try {
      const res: LLMCallResult = await opts.llm.call({
        system: systemPrompt,
        user: userMsg,
        label: `sub-agent[${opts.id}]`,
        temperature: 0.3,
      });
      action = parseAction(res.text);
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors++;
      if (consecutiveErrors > 2) {
        turns.push({
          turnIndex: i,
          thought: '(LLM call failed)',
          tool: 'giveUp',
          args: {},
          result: { ok: false, error: (e as Error).message, durationMs: Date.now() - turnStart },
          durationMs: Date.now() - turnStart,
          startedAt: turnStart,
          terminal: true,
          level: 'sub-agent',
          task: opts.task,
        });
        outcome = 'error';
        break;
      }
      continue;
    }

    if (!action) {
      // LLM didn't return parseable JSON. Treat as a "think more" moment.
      turns.push({
        turnIndex: i,
        thought: '(could not parse action)',
        tool: 'giveUp',
        args: {},
        result: { ok: false, error: 'parse failed', durationMs: Date.now() - turnStart },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        terminal: true,
        level: 'sub-agent',
        task: opts.task,
      });
      outcome = 'invalid';
      break;
    }

    // Stop on giveUp
    if (action.tool === 'giveUp' || action.tool === 'stop') {
      turns.push({
        turnIndex: i,
        thought: action.thought,
        tool: action.tool,
        args: action.args,
        result: { ok: true, durationMs: 0 },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        terminal: true,
        level: 'sub-agent',
        task: opts.task,
      });
      outcome = 'clean';
      break;
    }

    // writeFinding goes through triage
    if (action.tool === 'writeFinding') {
      const { finding, triage } = await emitFinding(opts.ctx, action.args as never, opts.llm);
      if (finding) {
        findings.push(finding);
        opts.onFinding?.(finding);
        observations.push(`writeFinding accepted: ${finding.type} on ${finding.endpoint}`);
        outcome = 'vulnerable';
      } else {
        observations.push(`writeFinding rejected: ${triage.reasoning}`);
      }
      turns.push({
        turnIndex: i,
        thought: action.thought,
        tool: action.tool,
        args: action.args,
        result: { ok: !!finding, error: finding ? undefined : triage.reasoning, durationMs: Date.now() - turnStart },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        terminal: !!finding,
        level: 'sub-agent',
        task: opts.task,
      });
      if (finding) break;
      continue;
    }

    // spawnAgent: recursive sub-agent (limited by budget in caller)
    if (action.tool === 'spawnAgent') {
      // Treat as observation — meta-orchestrator's job to spawn, not sub-agent's
      observations.push(`sub-agent tried to spawnAgent: ${action.args.task ?? '(no task)'} — ignored`);
      turns.push({
        turnIndex: i,
        thought: action.thought,
        tool: action.tool,
        args: action.args,
        result: { ok: true, value: 'spawnAgent from sub-agent is not supported; record observations only', durationMs: Date.now() - turnStart },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        level: 'sub-agent',
        task: opts.task,
      });
      continue;
    }

    // Direct primitive call
    if (!opts.tools.includes(action.tool as PrimitiveName)) {
      observations.push(`sub-agent tried to call "${action.tool}" which is not in its tool set — ignored`);
      turns.push({
        turnIndex: i,
        thought: action.thought,
        tool: action.tool,
        args: action.args,
        result: { ok: false, error: `tool not in sub-agent's set`, durationMs: Date.now() - turnStart },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        level: 'sub-agent',
        task: opts.task,
      });
      continue;
    }

    let result: PrimitiveResult;
    try {
      result = await executePrimitive(action.tool as PrimitiveName, action.args, opts.ctx);
    } catch (e) {
      result = { ok: false, error: (e as Error).message, durationMs: 0 };
    }

    // Auto-record interesting results as observations
    if (!result.ok) {
      observations.push(`${action.tool} error: ${result.error}`);
    } else if (result.value !== undefined) {
      const v = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
      if (v.length < 300) {
        observations.push(`${action.tool} → ${v.slice(0, 200)}`);
      }
    }
    opts.onObservation?.(`sub-agent[${opts.id}] turn ${i + 1}: ${action.thought.slice(0, 100)}`);

    turns.push({
      turnIndex: i,
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
      level: 'sub-agent',
      task: opts.task,
    });
  }

  return {
    id: opts.id,
    task: opts.task,
    tools: opts.tools as string[],
    strategy: opts.strategy,
    maxAttempts,
    turns,
    findings: findings as unknown as Array<Record<string, unknown>>,
    observations,
    startedAt,
    endedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    outcome,
  };
}

function summarizeOwnTurns(turns: AgentTurn[], findings: AppModelFinding[]): string {
  if (turns.length === 0) return 'No turns yet. Begin exploring.';
  const lines: string[] = [];
  for (const t of turns) {
    if (t.tool === 'giveUp') {
      lines.push(`turn ${t.turnIndex + 1}: gave up — ${t.thought.slice(0, 100)}`);
      continue;
    }
    if (t.tool === 'writeFinding') {
      lines.push(`turn ${t.turnIndex + 1}: writeFinding ${t.result?.ok ? 'ACCEPTED' : 'rejected'} — ${t.thought.slice(0, 100)}`);
      continue;
    }
    const r = t.result;
    const v = r?.value !== undefined
      ? (typeof r.value === 'string' ? r.value : JSON.stringify(r.value).slice(0, 200))
      : (r?.error ?? '(no result)');
    lines.push(`turn ${t.turnIndex + 1}: ${t.tool} → ${v.slice(0, 150)}`);
  }
  if (findings.length > 0) {
    lines.push(`\nFindings so far: ${findings.length}`);
    for (const f of findings) lines.push(`  - ${f.type} on ${f.endpoint} (${f.severity})`);
  }
  return lines.join('\n');
}
