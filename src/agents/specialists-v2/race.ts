// src/agents/specialists-v2/race.ts
// Race condition specialist: TOCTOU on balance/transfer endpoints.
// Full implementation: K=20 parallel requests, look for inconsistency.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are a race condition specialist. Your job is to determine if a state-changing endpoint is vulnerable to TOCTOU (time-of-check vs time-of-use).

Approach:
1. Find endpoints that look like balance/transfer/coupon-redeem/inventory: POST /api/transfer, POST /api/coupon/redeem, POST /api/cart/checkout.
2. Capture the current state: GET /api/balance -> 100.
3. Send K=20 parallel POSTs of "transfer 100" or "redeem coupon X".
4. After all complete, GET /api/balance. If 0 or negative, the race is real.

Tools:
- burst: send N parallel identical requests, return all responses
- httpRequest: single request
- conclude: write finding

Strong evidence: before state = 100, after state = 0, K=20 requests all returned 200.`;

export const raceSpecialist: SpecialistFactory = {
  name: 'race',
  description: 'Race condition (TOCTOU) on balance/transfer/coupon endpoints. K=20 parallel.',
  shouldInclude: (appModel: AppModel) => {
    const endpoints = appModel.endpoints || [];
    return endpoints.some((e) => /transfer|balance|redeem|coupon|withdraw|claim/i.test(e.path));
  },
  build: (tools) => ({
    name: 'race',
    description: 'Race condition (TOCTOU) on balance/transfer/coupon endpoints. K=20 parallel.',
    systemPrompt: SYSTEM_PROMPT,
    tools: ['httpRequest', 'burst', 'scratchpadWrite', 'scratchpadRead', 'conclude'].map((n) => tools[n as keyof typeof tools]).filter(Boolean) as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  }),
};

/** Helper: send N parallel identical requests, return all responses. */
export async function burst<T>(k: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: k }, (_, i) => fn(i)));
}
