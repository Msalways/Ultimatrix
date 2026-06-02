/**
 * src/explorer/decision-commenter.ts
 *
 * LLM-driven decision commenter.
 *
 * For every action the swarm takes, this module can produce a 1-sentence
 * comment explaining WHY. Uses an LLM (configurable) with a structured
 * output contract. Falls back to a templated comment if LLM is unavailable
 * or errors out.
 *
 * The comments are appended to the live-streaming Playwright spec file as
 * "Tier 3" documentation, so a reader of the file can understand the
 * reasoning flow of the scan without reading the full report.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface DecisionContext {
  agent: 'strategist' | 'worker' | 'specialist';
  action: string;
  target: string;
  reasoning?: string;
  priorFindings?: number;
  currentRisk?: number;
  hypotheses?: string[];
}

export interface DecisionComment {
  text: string;
  source: 'llm' | 'fallback';
  latencyMs?: number;
}

const FALLBACK_TEMPLATES: Record<DecisionContext['agent'], string> = {
  strategist: 'Orchestrator dispatched next action based on accumulated findings',
  worker: 'Worker attempted to verify the hypothesis via raw HTTP probe',
  specialist: 'Specialist was activated for its relevance to the observed target',
};

export function fallbackComment(ctx: DecisionContext): DecisionComment {
  const base = FALLBACK_TEMPLATES[ctx.agent] || 'Action taken';
  const target = ctx.target ? ` on ${truncate(ctx.target, 60)}` : '';
  return { text: `${base}${target}`, source: 'fallback' };
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const DECISION_PROMPT = `You are the documentation layer for a security research swarm.
Given a single action taken by the swarm, produce a SHORT comment (1 sentence, <= 120 chars) explaining WHY this action was taken, from the perspective of a human security researcher reading the test code.

Rules:
- Plain English, no jargon
- Reference the target/endpoint if provided
- Mention the risk or signal that triggered the action
- Output ONLY the comment line (no quotes, no bullet, no prefix)
- Avoid these trigger words: exploit, attack, payload, injection, malicious. Use "test input", "test string", "security test"

Context:
- Agent role: {agent}
- Action: {action}
- Target: {target}
- Reasoning hint: {reasoning}
- Prior findings: {priorFindings}
- Current risk score: {currentRisk}
- Active hypotheses: {hypotheses}`;

export async function generateDecisionComment(
  llm: BaseChatModel | null | undefined,
  ctx: DecisionContext,
): Promise<DecisionComment> {
  if (!llm) return fallbackComment(ctx);
  const start = Date.now();
  try {
    const prompt = DECISION_PROMPT
      .replace('{agent}', ctx.agent)
      .replace('{action}', ctx.action)
      .replace('{target}', ctx.target || '(none)')
      .replace('{reasoning}', ctx.reasoning || '(none)')
      .replace('{priorFindings}', String(ctx.priorFindings ?? 0))
      .replace('{currentRisk}', String(ctx.currentRisk ?? 0))
      .replace('{hypotheses}', (ctx.hypotheses || []).join(', ') || '(none)');
    const res = await llm.invoke(prompt);
    const text = String(res.content ?? res).trim().split('\n')[0].slice(0, 200);
    if (!text) return fallbackComment(ctx);
    return { text, source: 'llm', latencyMs: Date.now() - start };
  } catch {
    return fallbackComment(ctx);
  }
}

export class DecisionCommenter {
  private llm: BaseChatModel | null | undefined;
  private cache: Map<string, DecisionComment> = new Map();

  constructor(llm?: BaseChatModel | null) {
    this.llm = llm;
  }

  async comment(ctx: DecisionContext): Promise<DecisionComment> {
    const key = `${ctx.agent}|${ctx.action}|${ctx.target}|${ctx.reasoning ?? ''}`;
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const result = await generateDecisionComment(this.llm, ctx);
    this.cache.set(key, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
