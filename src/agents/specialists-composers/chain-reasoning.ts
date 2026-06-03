// src/agents/specialists-composers/chain-reasoning.ts
//
// Chain-reasoning specialist composer. Spawned at the end of a run to
// look for chains across the accumulated findings. Unlike the heuristic
// chain templates, this composer asks the LLM to reason about how
// findings could be combined into higher-severity attack paths.
//
// Output: a single AttackChain (or a list of chains) with a narrative
// the LLM wrote, evidence cross-references, and a step-by-step
// description of how the chain would execute in practice.

import type { LLMClient } from '../../llm/client';
import type { AppModelFinding, AttackChain } from '../../core/app-model';

export interface ChainReasoningInput {
  findings: AppModelFinding[];
  target: string;
  llm: LLMClient;
}

export interface ChainReasoningResult {
  chains: AttackChain[];
  durationMs: number;
  llmWasReal: boolean;
}

const SYSTEM_PROMPT_CHAIN = `You are the chain-reasoning specialist for Ultimatrix. You are given a list of security findings and you must reason about how an attacker could chain them into a higher-severity exploit.

For each chain, provide:
- "name": short name (e.g., "account-takeover-via-stolen-session")
- "severity": "critical" | "high" | "medium"
- "narrative": 2-3 sentences explaining the chain in plain English
- "steps": array of {findingType, endpoint, description} — the ordered steps
- "impact": final consequence (e.g., "full account takeover", "data exfiltration")

Return JSON: {"chains": [...]}

If no chains are possible, return {"chains": []}.`;

export async function runChainReasoning(input: ChainReasoningInput): Promise<ChainReasoningResult> {
  const start = Date.now();

  if (!input.llm.isReal() || input.findings.length === 0) {
    return { chains: [], durationMs: Date.now() - start, llmWasReal: input.llm.isReal() };
  }

  // Compact finding summary to fit in context
  const findingsSummary = input.findings.map((f) => ({
    type: f.type,
    endpoint: f.endpoint,
    method: f.method,
    param: f.param,
    severity: f.severity,
    confidence: f.confidence,
    description: f.description,
  }));

  const r = await input.llm.call({
    system: SYSTEM_PROMPT_CHAIN,
    user: `Target: ${input.target}\n\nFindings:\n${JSON.stringify(findingsSummary, null, 2)}\n\nReason about chains.`,
    temperature: 0.3,
    maxTokens: 2000,
  });

  const chains: AttackChain[] = [];
  if (r.json && typeof r.json === 'object') {
    const j = r.json as { chains?: unknown };
    if (Array.isArray(j.chains)) {
      for (let i = 0; i < j.chains.length; i++) {
        const c = j.chains[i] as any;
        if (!c || typeof c !== 'object') continue;
        chains.push({
        id: `chain-${Date.now()}-${i}`,
        name: String(c.name ?? 'unnamed-chain'),
        severity: (c.severity ?? 'high') as 'critical' | 'high' | 'medium' | 'low',
        confidence: 0.7,
        exploitability: 'moderate',
        narrative: String(c.narrative ?? ''),
        discoveredAt: Date.now(),
        steps: Array.isArray(c.steps) ? c.steps.map((s: any, si: number) => ({
          step: si + 1,
          findingType: String(s.findingType ?? ''),
          endpoint: String(s.endpoint ?? ''),
          description: String(s.description ?? '') + (c.impact ? ` [impact: ${c.impact}]` : ''),
          evidenceRef: '',
        })) : [],
      });
      }
    }
  }

  return { chains, durationMs: Date.now() - start, llmWasReal: true };
}
