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
//
// Block 9 changes:
// - SubAgentOptions gains `depth` (default 0) and `allowSpawn`
//   (default `depth < 2`).
// - When `allowSpawn === false`, the `spawnAgent` tool is filtered out of
//   the sub-agent's allowed tool set at the schema layer (no fake-success
//   "ignored" observation; the LLM never sees the tool).
// - When `allowSpawn === true`, a sub-agent CAN call `spawnAgent`
//   recursively. The sub-sub-agent's `SubAgentRun` is attached to the
//   parent's `subSubAgents[]` and its findings + observations propagate
//   back through the normal channels.
// - Auto-observation generation: dropped the 300-char gate. Always record.
//   Object values get a structured `{shape, excerpt}` summary so the LLM
//   sees the data shape even when the value is large.
// - `findings: AppModelFinding[]` instead of
//   `Array<Record<string, unknown>>`.

import type { LLMClient, LLMCallResult } from '../llm/client';
import type { PrimitiveContext, PrimitiveName, PrimitiveResult } from '../primitives/types';
import type { AppModelFinding } from '../core/app-model';
import { executePrimitive } from './primitive-helpers';
import { emitFinding } from './finding';
import { buildSubAgentPrompt } from './agent-prompts';
import { schemasForToolNames } from './tool-schema';
import type { SubAgentRun, AgentTurn } from './agent-trace';
import { TraceBuilder } from './agent-trace';

export interface SubAgentOptions {
  id: string;
  task: string;
  tools: PrimitiveName[];
  strategy?: string;
  maxAttempts?: number;
  target: string;
  ctx: PrimitiveContext;
  llm: LLMClient;
  /** Recursion depth: 0 = meta-orchestrator-spawned, 1 = sub-sub-agent. Default 0. */
  depth?: number;
  /** Force allow/deny spawnAgent for this sub-agent. Default: depth < 2 */
  allowSpawn?: boolean;
  /** Parent sub-agent's id, used to set SubAgentRun.parentId. */
  parentId?: string;
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

const SPAWN_AGENT_TOOL = 'spawnAgent';

export async function runSubAgent(opts: SubAgentOptions): Promise<SubAgentRun> {
  const depth = opts.depth ?? 0;
  const allowSpawn = opts.allowSpawn ?? (depth < 2);

  // Filter spawnAgent out of the schema if the sub-agent can't recurse.
  // The LLM never sees the tool, so it can't ask for it.
  const allowedTools: PrimitiveName[] = allowSpawn
    ? ([...opts.tools, SPAWN_AGENT_TOOL as PrimitiveName] as PrimitiveName[])
    : (opts.tools.filter((t) => (t as string) !== SPAWN_AGENT_TOOL) as PrimitiveName[]);

  const maxAttempts = opts.maxAttempts ?? 5;
  const startedAt = Date.now();
  const turns: AgentTurn[] = [];
  const findings: AppModelFinding[] = [];
  const observations: string[] = [];
  const subSubAgents: SubAgentRun[] = [];
  let outcome: SubAgentRun['outcome'] = 'inconclusive';
  let consecutiveErrors = 0;

  const toolSchemas = schemasForToolNames(allowedTools as string[]);
  const systemPrompt = buildSubAgentPrompt({
    task: opts.task,
    target: opts.target,
    strategy: opts.strategy ?? '',
    toolSchemas,
    maxAttempts,
  });

  const builder = new TraceBuilder();

  for (let i = 0; i < maxAttempts; i++) {
    const turnStart = Date.now();
    const historySummary = summarizeOwnTurns(turns, findings, subSubAgents);

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

    if (action.tool === 'writeFinding') {
      const { finding, triage } = await emitFinding(opts.ctx, action.args as never, opts.llm);
      if (finding) {
        findings.push(finding);
        builder.addFinding(finding);
        opts.onFinding?.(finding);
        observations.push(`writeFinding accepted: ${finding.type} on ${finding.endpoint} (${finding.severity})`);
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

    // Recursive spawnAgent: only allowed if `allowSpawn` is true.
    if (action.tool === SPAWN_AGENT_TOOL) {
      if (!allowSpawn) {
        // Should never happen — schema was filtered. Defensive: honest rejection.
        turns.push({
          turnIndex: i,
          thought: action.thought,
          tool: action.tool,
          args: action.args,
          result: { ok: false, error: `spawnAgent not available at depth ${depth} (max recursion depth 2)`, durationMs: Date.now() - turnStart },
          durationMs: Date.now() - turnStart,
          startedAt: turnStart,
          level: 'sub-agent',
          task: opts.task,
        });
        continue;
      }
      const spec = action.args as {
        task?: string;
        tools?: string[];
        maxAttempts?: number;
        strategy?: string;
      };
      const subRun = await runSubAgent({
        id: `${opts.id}->sub-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        task: String(spec.task ?? '(no task)'),
        tools: (spec.tools ?? []) as PrimitiveName[],
        strategy: spec.strategy,
        maxAttempts: spec.maxAttempts ?? Math.min(3, maxAttempts),
        target: opts.target,
        ctx: opts.ctx,
        llm: opts.llm,
        depth: depth + 1,
        allowSpawn: depth + 1 < 2,
        parentId: opts.id,
        onFinding: (f) => {
          findings.push(f);
          builder.addFinding(f);
          opts.onFinding?.(f);
        },
        onObservation: (o) => observations.push(`[sub-sub] ${o}`),
      });
      subSubAgents.push(subRun);
      observations.push(
        `spawned sub-sub-agent: "${subRun.task.slice(0, 80)}" — outcome=${subRun.outcome}, findings=${subRun.findings.length}, turns=${subRun.turns.length}`,
      );
      turns.push({
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
            note: 'sub-sub-agent finished — full trace attached to parent.subSubAgents',
          },
          durationMs: Date.now() - turnStart,
        },
        durationMs: Date.now() - turnStart,
        startedAt: turnStart,
        level: 'sub-agent',
        task: opts.task,
      });
      continue;
    }

    if (!allowedTools.includes(action.tool as PrimitiveName)) {
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

    // Auto-record observations for non-trivial results.
    if (!result.ok) {
      observations.push(`${action.tool} error: ${result.error}`);
    } else if (result.value !== undefined) {
      const obs = formatObservation(action.tool, result.value);
      if (obs) observations.push(obs);
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
    findings,
    observations,
    startedAt,
    endedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    outcome,
    parentId: opts.parentId,
    depth,
    subSubAgents,
  };
}

/**
 * Build a one-line observation from a primitive result value. The LLM uses
 * this in its next-turn reasoning. Always returns a string; never drops
 * the value entirely. Caps per-observation at 800 chars.
 *
 * Exported for unit testing — the LLM's "did the sub-agent's auto-obs
 * preserve the data shape?" is a critical invariant.
 */
export function formatObservation(tool: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `${tool} → null`;
  }
  if (typeof value === 'string') {
    const v = value.length > 800 ? value.slice(0, 800) + `…(truncated ${value.length - 800} chars)` : value;
    return `${tool} → ${v}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${tool} → ${String(value)}`;
  }
  // Object/array: emit a shape summary + a 500-char excerpt of the JSON.
  const json = safeStringify(value);
  const shape = describeShape(value);
  const excerpt = json.length > 500 ? json.slice(0, 500) + `…(truncated ${json.length - 500} chars)` : json;
  return `${tool} → {${shape}, excerpt: ${excerpt}}`;
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array(0)';
    const sample = value.slice(0, 3).map((v) => typeof v);
    return `array(${value.length}, [${sample.join(', ')}])`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object{${keys.slice(0, 8).join(', ')}${keys.length > 8 ? `, +${keys.length - 8} more` : ''}}`;
  }
  return typeof value;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeOwnTurns(turns: AgentTurn[], findings: AppModelFinding[], subSubAgents: SubAgentRun[]): string {
  if (turns.length === 0 && subSubAgents.length === 0) return 'No turns yet. Begin exploring.';
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
    if (t.tool === 'spawnAgent') {
      const v = t.result?.value as { outcome?: string; findingsCount?: number } | undefined;
      lines.push(`turn ${t.turnIndex + 1}: spawnAgent → outcome=${v?.outcome ?? '?'}, findings=${v?.findingsCount ?? 0}`);
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
  for (const ss of subSubAgents) {
    lines.push(`\nSub-sub-agent: "${ss.task.slice(0, 60)}" — outcome=${ss.outcome}, findings=${ss.findings.length}, turns=${ss.turns.length}`);
  }
  return lines.join('\n');
}
