/**
 * src/agents/middleware/agent-decision-emitter.ts
 *
 * Middleware that emits "agent_decision" events to the dashboard for every
 * tool call the agent makes. This gives judges and operators a live view of
 * WHAT the agent is doing and WHY (linked to a decision comment).
 *
 * Each event has:
 *   - id: unique identifier
 *   - timestamp
 *   - agent: name of the agent (strategist/worker/<specialist>)
 *   - tool: tool name being called
 *   - args: redacted arguments
 *   - decision: 1-sentence comment from DecisionCommenter
 *   - risk: current risk score (0-10)
 *
 * The middleware is a no-op if no event sink is provided. This makes it
 * safe to include unconditionally in the middleware stack.
 */

import type { DecisionCommenter } from '../../explorer/decision-commenter';

export interface AgentDecision {
  id: string;
  timestamp: string;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  decision: string;
  risk: number;
  source: 'llm' | 'fallback';
}

export type AgentDecisionSink = (event: AgentDecision) => void;

const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'apikey', 'api_key', 'authorization', 'cookie', 'sessionid', 'session_id']);

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '••••••';
    } else if (typeof v === 'string' && v.length > 200) {
      out[k] = v.slice(0, 200) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

let nextId = 1;
function makeId(): string {
  return `dec-${Date.now()}-${nextId++}`;
}

export interface EmitOptions {
  sink: AgentDecisionSink;
  commenter: DecisionCommenter;
  getRisk?: () => number;
  agentName?: string;
}

export class AgentDecisionEmitter {
  private sink: AgentDecisionSink;
  private commenter: DecisionCommenter;
  private getRisk: () => number;
  private agentName: string;
  private enabled: boolean;

  constructor(opts: EmitOptions) {
    this.sink = opts.sink;
    this.commenter = opts.commenter;
    this.getRisk = opts.getRisk || (() => 0);
    this.agentName = opts.agentName || 'agent';
    this.enabled = true;
  }

  disable(): void { this.enabled = false; }
  enable(): void { this.enabled = true; }
  isEnabled(): boolean { return this.enabled; }

  async emitToolCall(tool: string, args: Record<string, unknown>, reasoningHint?: string): Promise<AgentDecision> {
    if (!this.enabled) {
      return {
        id: makeId(),
        timestamp: new Date().toISOString(),
        agent: this.agentName,
        tool,
        args: redactArgs(args),
        decision: reasoningHint || 'Tool call',
        risk: this.getRisk(),
        source: 'fallback',
      };
    }
    const comment = await this.commenter.comment({
      agent: 'worker',
      action: `call ${tool}`,
      target: String(args['url'] || args['endpoint'] || args['path'] || ''),
      reasoning: reasoningHint,
      currentRisk: this.getRisk(),
    });
    const event: AgentDecision = {
      id: makeId(),
      timestamp: new Date().toISOString(),
      agent: this.agentName,
      tool,
      args: redactArgs(args),
      decision: comment.text,
      risk: this.getRisk(),
      source: comment.source,
    };
    this.sink(event);
    return event;
  }

  async emitReasoning(reasoning: string, hypotheses?: string[]): Promise<AgentDecision> {
    if (!this.enabled) {
      return {
        id: makeId(),
        timestamp: new Date().toISOString(),
        agent: this.agentName,
        tool: 'reasoning',
        args: {},
        decision: reasoning.slice(0, 200),
        risk: this.getRisk(),
        source: 'fallback',
      };
    }
    const comment = await this.commenter.comment({
      agent: 'strategist',
      action: 'reasoning',
      target: '',
      reasoning,
      currentRisk: this.getRisk(),
      hypotheses,
    });
    const event: AgentDecision = {
      id: makeId(),
      timestamp: new Date().toISOString(),
      agent: this.agentName,
      tool: 'reasoning',
      args: {},
      decision: comment.text,
      risk: this.getRisk(),
      source: comment.source,
    };
    this.sink(event);
    return event;
  }
}

export class NoopAgentDecisionEmitter extends AgentDecisionEmitter {
  constructor() {
    super({
      sink: () => {},
      commenter: { comment: async () => ({ text: '', source: 'fallback' as const }), clearCache: () => {} } as unknown as DecisionCommenter,
    });
  }
  async emitToolCall(): Promise<AgentDecision> {
    return {
      id: 'noop',
      timestamp: new Date().toISOString(),
      agent: 'noop',
      tool: '',
      args: {},
      decision: '',
      risk: 0,
      source: 'fallback',
    };
  }
  async emitReasoning(): Promise<AgentDecision> {
    return {
      id: 'noop',
      timestamp: new Date().toISOString(),
      agent: 'noop',
      tool: '',
      args: {},
      decision: '',
      risk: 0,
      source: 'fallback',
    };
  }
}
