// src/agents/agent-trace.ts
//
// Structured trace of a meta-orchestrator's run or a sub-agent's run.
// Captures every turn: the LLM's thought, the tool call, the result, the
// reasoning. No fixed structure beyond "turns and tool calls" — the trace
// reflects whatever the LLM did.

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
  findings: Array<Record<string, unknown>>;
  observations: string[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  outcome: 'vulnerable' | 'clean' | 'inconclusive' | 'invalid' | 'error';
}

export interface AgentTrace {
  /** Meta-orchestrator's turns */
  metaTurns: AgentTurn[];
  /** Sub-agents spawned during the run */
  subAgents: SubAgentRun[];
  /** Findings emitted (free-form) */
  findings: Array<Record<string, unknown>>;
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

  addFinding(finding: Record<string, unknown>): void {
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
 */
export function summarizeTrace(trace: AgentTrace, maxChars = 4000): string {
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
    lines.push(`\n## Sub-agent: ${s.task.slice(0, 100)}`);
    lines.push(`Tools: ${s.tools.join(', ')}`);
    lines.push(`Strategy: ${s.strategy ?? 'none'}`);
    lines.push(`Turns: ${s.turns.length}, Findings: ${s.findings.length}, Outcome: ${s.outcome}`);
    if (s.observations.length) {
      lines.push(`Observations:`);
      for (const o of s.observations.slice(0, 10)) lines.push(`  - ${o.slice(0, 200)}`);
    }
  }

  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…(truncated)';
  return text;
}
