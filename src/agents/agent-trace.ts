// src/agents/agent-trace.ts
//
// Structured trace of a meta-orchestrator's run or a sub-agent's run.
// Captures every turn: the LLM's thought, the tool call, the result, the
// reasoning. No fixed structure beyond "turns and tool calls" — the trace
// reflects whatever the LLM did.
//
// Block 9 changes:
// - SubAgentRun.findings is now typed as AppModelFinding[] (was
//   Array<Record<string, unknown>>), so downstream consumers can introspect.
// - SubAgentRun gains parentId and subSubAgents so the trace is a proper
//   tree, not a flat list (sub-agents can spawn sub-sub-agents up to
//   depth 2).
// - TraceBuilder.addFinding takes AppModelFinding, stores it as a record
//   for serialization compatibility.
// - summarizeTrace recurses into subSubAgents and emits three subsections
//   per sub-agent (Findings, Reasoning trace, Observations) so the
//   meta-orchestrator's next turn sees real context, not just a count.
//   Default cap raised from 4000 to 8000 chars.

import type { AppModelFinding } from '../core/app-model';

export interface AgentTurn {
  /** Turn number, 0-indexed */
  turnIndex: number;
  /** The LLM's reasoning before picking the tool */
  thought: string;
  /** Tool name the LLM picked (e.g. "httpRequest", "spawnAgent", "writeFinding") */
  tool: string;
  /** Arguments the LLM passed */
  args: Record<string, unknown>;
  /** The tool's result, if it ran */
  result?: {
    ok: boolean;
    value?: unknown;
    error?: string;
    durationMs: number;
  };
  /** When the turn completed */
  durationMs: number;
  /** Wall-clock start of the turn */
  startedAt: number;
  /** Free-form observations the LLM should see in the next turn */
  observations?: string[];
  /** True if the LLM called "giveUp" or returned an empty action */
  terminal?: boolean;
  /** Free-form label: "meta" | "sub-agent" | "sub-sub-agent" etc. */
  level: 'meta' | 'sub-agent';
  /** The sub-agent's task, if this turn is from a sub-agent */
  task?: string;
}

export interface SubAgentRun {
  id: string;
  task: string;
  tools: string[];
  strategy?: string;
  maxAttempts: number;
  turns: AgentTurn[];
  findings: AppModelFinding[];
  observations: string[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  outcome: 'vulnerable' | 'clean' | 'inconclusive' | 'invalid' | 'error';
  /** Parent sub-agent's id, or undefined for top-level (spawned by meta-orchestrator) */
  parentId?: string;
  /** Recursion depth: 0 = meta-orchestrator, 1 = sub-agent, 2 = sub-sub-agent */
  depth: number;
  /** Sub-sub-agents spawned by THIS sub-agent. Empty for depth-2 (max). */
  subSubAgents: SubAgentRun[];
}

export interface AgentTrace {
  /** Meta-orchestrator's turns */
  metaTurns: AgentTurn[];
  /** Sub-agents spawned during the run */
  subAgents: SubAgentRun[];
  /** Findings emitted (free-form) */
  findings: AppModelFinding[];
  /** Total wall time */
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Final outcome */
  outcome: 'vulnerable' | 'clean' | 'inconclusive' | 'invalid' | 'error';
}

export class TraceBuilder {
  private trace: AgentTrace;

  constructor() {
    this.trace = {
      metaTurns: [],
      subAgents: [],
      findings: [],
      startedAt: Date.now(),
      endedAt: 0,
      durationMs: 0,
      outcome: 'inconclusive',
    };
  }

  addMetaTurn(turn: Omit<AgentTurn, 'level'>): void {
    this.trace.metaTurns.push({ ...turn, level: 'meta' });
  }

  addSubAgent(run: SubAgentRun): void {
    this.trace.subAgents.push(run);
  }

  addFinding(finding: AppModelFinding): void {
    this.trace.findings.push(finding);
  }

  setOutcome(outcome: AgentTrace['outcome']): void {
    this.trace.outcome = outcome;
  }

  finalize(): AgentTrace {
    this.trace.endedAt = Date.now();
    this.trace.durationMs = this.trace.endedAt - this.trace.startedAt;
    return this.trace;
  }

  current(): AgentTrace {
    return { ...this.trace, metaTurns: [...this.trace.metaTurns] };
  }
}

/**
 * Summarize a trace for inclusion in the next LLM turn. Keeps the context
 * window manageable. Format is free-form — the LLM reads it as a status report.
 *
 * For each sub-agent we emit three subsections:
 *   ### Findings      — all findings, one line each (not just count)
 *   ### Reasoning trace — per-turn thoughts + tool + result
 *   ### Observations  — first 30 × 300 chars
 *
 * Sub-sub-agents are rendered recursively.
 */
export function summarizeTrace(trace: AgentTrace, maxChars = 8000): string {
  const lines: string[] = [];

  lines.push(`# Trace so far (${trace.metaTurns.length} meta turns, ${trace.subAgents.length} sub-agents, ${trace.findings.length} findings)`);

  for (const t of trace.metaTurns) {
    lines.push(`\n## Meta turn ${t.turnIndex}`);
    lines.push(`Thought: ${t.thought.slice(0, 300)}`);
    lines.push(`Tool: ${t.tool}`);
    if (t.result?.ok) {
      const v = typeof t.result.value === 'string' ? t.result.value : JSON.stringify(t.result.value ?? '').slice(0, 300);
      lines.push(`Result: ok (${v.slice(0, 200)}…)`);
    } else if (t.result) {
      lines.push(`Result: error — ${t.result.error}`);
    }
    if (t.observations?.length) {
      lines.push(`Observations:`);
      for (const o of t.observations) lines.push(`  - ${o.slice(0, 200)}`);
    }
  }

  for (const s of trace.subAgents) {
    renderSubAgent(lines, s, '## Sub-agent', 8000);
  }

  let text = lines.join('\n');
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + `\n…(truncated ${text.length - maxChars} chars)`;
  }
  return text;
}

function renderSubAgent(
  lines: string[],
  s: SubAgentRun,
  headerPrefix: string,
  perAgentCharCap: number,
): void {
  lines.push(`\n${headerPrefix}: ${s.task.slice(0, 100)}`);
  lines.push(`Tools: ${s.tools.join(', ')}`);
  lines.push(`Strategy: ${s.strategy ?? 'none'}`);
  lines.push(`Outcome: ${s.outcome}  |  Turns: ${s.turns.length}  |  Duration: ${s.durationMs}ms  |  Findings: ${s.findings.length}  |  Sub-sub-agents: ${s.subSubAgents.length}`);

  if (s.findings.length > 0) {
    lines.push(`### Findings (${s.findings.length})`);
    for (const f of s.findings) {
      const desc = (f.description ?? '').slice(0, 200);
      lines.push(`- ${f.type} on ${f.method ?? '?'} ${f.endpoint} (${f.severity}, conf=${f.confidence}) — ${desc}`);
    }
  }

  if (s.turns.length > 0) {
    lines.push(`### Reasoning trace`);
    for (const t of s.turns) {
      const r = t.result;
      let v: string;
      if (r) {
        v = typeof r.value === 'string' ? r.value : JSON.stringify(r.value ?? '').slice(0, 150);
        if (!r.ok && r.error) v = `error: ${r.error}`;
      } else {
        v = '(no result)';
      }
      const thought = (t.thought ?? '').slice(0, 150);
      const isError = !!r && !r.ok;
      lines.push(`turn ${t.turnIndex + 1}: ${thought} → ${t.tool}${isError ? ' ✗' : ''} → ${v.slice(0, 150)}`);
    }
  }

  if (s.observations.length > 0) {
    lines.push(`### Observations (${s.observations.length})`);
    for (const o of s.observations.slice(0, 30)) {
      lines.push(`- ${o.slice(0, 300)}`);
    }
    if (s.observations.length > 30) {
      lines.push(`- …(${s.observations.length - 30} more)`);
    }
  }

  for (const ss of s.subSubAgents) {
    renderSubAgent(lines, ss, '## Sub-sub-agent', perAgentCharCap);
  }
}
