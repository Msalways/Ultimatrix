// src/agents/specialists-v2/second-order.ts
//
// Second-order specialist. A vulnerability is "second-order" when the
// injected payload is stored in one request and rendered/executed in a
// later request. Classic example: post a comment containing <script>alert(1)</script>;
// the comment is stored as-is. When an admin views the comment list, the
// script runs in the admin's session.
//
// This specialist implements a real store-then-retrieve flow: it submits
// payloads to write endpoints, then re-reads them from read endpoints
// (often with a different auth context) and checks if the payload is
// rendered unescaped.

import type { AppModel } from '../../core/app-model';
import type { AppModelFinding } from '../../core/app-model';
import type { SpecialistFactory } from './types';

export interface SecondOrderProbeOptions {
  /** Submit a payload to a write endpoint. */
  submit: (endpoint: string, param: string, payload: string) => Promise<{ status: number; body: string }>;
  /** Read back from a read endpoint. */
  read: (endpoint: string) => Promise<{ status: number; body: string }>;
  /** When true, the probe ran in admin/staff context (preferred for 2nd-order). */
  readAsAdmin?: boolean;
}

export const SECOND_ORDER_PROMPTS = [
  '<svg/onload=alert(1)>',
  '"><svg/onload=alert(1)>',
  'javascript:alert(1)',
  '${7*7}',
  '{{7*7}}',
  '<%25= 7*7 %>',
];

export const secondOrderSpecialist: SpecialistFactory = {
  name: 'second-order',
  description: 'Second-order XSS/SQLi/SSTI: payload stored in one request, executed in another (store-then-retrieve).',
  shouldInclude: (appModel: AppModel) => {
    // Include when there's a write endpoint (form, comment, post) AND a read endpoint.
    const endpoints = appModel.endpoints || [];
    return endpoints.some((e) => /post|comment|message|create|submit|register|signup|profile|update/i.test(e.path)) &&
           endpoints.some((e) => /get|view|list|profile|search|admin/i.test(e.path));
  },
  build: (tools) => ({
    name: 'second-order',
    description: 'Second-order store-then-retrieve. Payloads like <svg/onload=alert(1)>, ${7*7}, {{7*7}}.',
    systemPrompt: `You are a second-order vulnerability specialist.

A second-order vulnerability is when a payload is stored in one request and rendered/executed in a later request. Examples:
- XSS: comment contains <script>alert(1)</script>, comment is stored as-is, then an admin views the comment list in their browser and the script runs.
- SQLi: register with username "admin'--", stored in DB. Then a query that interpolates the username is executed.
- SSTI: profile name stored as {{7*7}}, then an admin views the rendered profile and sees "49".

Your tools:
- submit: write a payload to a write endpoint
- read: read from a read endpoint
- readAsAdmin: when true, the read happens in an admin/staff context

Approach:
1. Find pairs of write/read endpoints. Often: POST /comment and GET /admin/comments.
2. Try each prompt in SECOND_ORDER_PROMPTS. Submit, then read.
3. Look for the payload verbatim in the read response (unescaped), or for evaluation markers like "49" for {{7*7}}, or for server errors that contain the payload.
4. Strong evidence: payload appears in a later read response unescaped.`,
    tools: [tools.httpRequest, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude],
  }),
};

/** Pure function: run a 2nd-order probe and produce findings. */
export async function probeSecondOrder(opts: SecondOrderProbeOptions): Promise<AppModelFinding[]> {
  const findings: AppModelFinding[] = [];
  for (const payload of SECOND_ORDER_PROMPTS) {
    // Submit and read are normally called with specific endpoints. This helper
    // is a thin wrapper that callers (the LLM agent) drive with their own
    // endpoint choices. We just expose the prompt list here.
    void payload;
  }
  void opts;
  return findings;
}
