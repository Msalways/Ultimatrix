// src/agents/finding.ts
//
// Helper for writeFinding. The LLM's writeFinding call is gated by triage
// (a separate LLM call that confirms the finding has concrete evidence).
// The LLM names findings freely — type, severity, param are all free-form
// strings, not enums.

import type { LLMClient, LLMCallResult } from '../llm/client';
import type { AppModelFinding, FindingEvidence } from '../core/app-model';
import { recordEvidencePrimitive, writeFindingPrimitive } from './primitive-helpers';
import type { PrimitiveContext } from '../primitives/types';
import { getGlobalGraphStore } from '../workflow-graph/store';

export interface ProposedFinding {
  type: string;
  endpoint: string;
  param: string;
  method?: string;
  payload?: string;
  description?: string;
  severity: string;
  confidence: number;
}

export interface TriageResult {
  real: boolean;
  reasoning: string;
}

const TRIAGE_PROMPT = `You are the triage module of an AI security researcher.

The agent just claimed a vulnerability. Decide if it's REAL.

REAL means there is concrete evidence the attack worked:
- For XSS: the payload string appears UNESCAPED in the response body (or the rendered DOM).
- For SQLi: a different response from baseline OR a SQL error message OR a confirmed time-based delay.
- For SSRF: the server fetched the attacker URL (e.g., an OAST callback fired, or response contains attacker-controlled content).
- For IDOR: the response contains data the original user shouldn't see.
- For open-redirect: the Location header points to the attacker domain.
- For path traversal: the response contains the target file's contents.
- For RCE / command injection: the response contains command output.
- For XXE: the response contains the target file's contents or the SSRF callback fired.
- For CSRF: the request still succeeds when the auth header is omitted.
- For "weird-thing" findings: there is some observable difference between baseline and attack responses, AND the difference is plausibly security-relevant (e.g., the framework rendered a payload as code).

NOT real if:
- The response is identical to baseline.
- The payload was sanitized / escaped / blocked.
- The response is 404 or 500 with no useful info.
- The agent is just hallucinating — no evidence in the recorded evidence log.

Return JSON only:
{ "real": true|false, "reasoning": "1-2 sentence explanation" }
`;

export async function triageFinding(
  llm: LLMClient,
  proposed: ProposedFinding,
  evidence: FindingEvidence[],
): Promise<TriageResult> {
  const userMsg = `Proposed finding:
${JSON.stringify(proposed, null, 2)}

Evidence log (${evidence.length} items):
${evidence.map((e) => `  [${e.type}] ${e.label}: ${String(e.data).slice(0, 400)}`).join('\n')}

Is this finding real?`;

  const res: LLMCallResult = await llm.call({
    system: TRIAGE_PROMPT,
    user: userMsg,
    label: 'triage',
    temperature: 0,
  });

  const parsed = (res.json ?? {}) as Partial<TriageResult>;
  return {
    real: !!parsed.real,
    reasoning: String(parsed.reasoning ?? 'triage did not return reasoning'),
  };
}

/**
 * Persist a proposed finding. Returns the AppModelFinding if triage confirmed
 * real, or null if rejected. Appends to the evidence log first so the
 * finding has a non-empty evidence array.
 */
export async function emitFinding(
  ctx: PrimitiveContext,
  proposed: ProposedFinding,
  llm: LLMClient,
): Promise<{ finding: AppModelFinding | null; triage: TriageResult }> {
  // Append a synthetic evidence item so the finding has at least the
  // proposed payload on record. Real evidence should be added via
  // recordEvidence before writeFinding.
  recordEvidencePrimitive(
    {
      type: 'text',
      data: `proposed: ${JSON.stringify(proposed)}`,
      label: 'proposed-finding',
      timestamp: Date.now(),
    },
    ctx,
  );

  const triage = await triageFinding(llm, proposed, ctx.evidenceLog);

  if (!triage.real) {
    return { finding: null, triage };
  }

  const writeResult = await writeFindingPrimitive(
    {
      type: proposed.type,
      endpoint: proposed.endpoint,
      param: proposed.param,
      method: proposed.method,
      payload: proposed.payload,
      description: proposed.description ?? triage.reasoning,
      severity: proposed.severity,
      confidence: proposed.confidence,
    },
    ctx,
  );

  if (!writeResult.ok || !writeResult.value) {
    return { finding: null, triage };
  }

  // Graph feedback: attach attack result to the matched graph node
  try {
    const store = getGlobalGraphStore();
    const matchingNode = store.findNodeByUrl(
      proposed.method || 'GET',
      proposed.endpoint,
    ) || store.findNodeByUrl(
      'GET',
      proposed.endpoint,
    );
    if (matchingNode) {
      store.addAttackResult(matchingNode.id, {
        technique: proposed.type,
        findingId: writeResult.value.id || '',
        confidence: proposed.confidence,
        payload: proposed.payload || '',
        evidence: ctx.evidenceLog.map((e) => `${e.label}: ${String(e.data).slice(0, 300)}`),
        timestamp: Date.now(),
      });
      // Also add tag
      store.addTag(matchingNode.id, `finding:${proposed.type}`);
    }
  } catch {
    // Best-effort — graph feedback is non-blocking
  }

  return { finding: writeResult.value, triage };
}
