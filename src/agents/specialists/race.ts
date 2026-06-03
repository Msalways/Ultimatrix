// src/agents/specialists/race.ts
//
// Race condition (TOCTOU) specialist — tests for:
//   1. balance-race: transfer/withdraw/deposit where balance is checked then deducted
//   2. coupon-race: coupon redeem where usage is checked then marked
//   3. invite-race: invite links where usage is checked then marked
//   4. upload-race: file upload with content scan then write
//   5. voting-race: votes where uniqueness is checked then recorded
//
// Selection heuristic: include when:
//   - Any endpoint has bodyFields matching transfer patterns (amount, balance, etc.)
//   - appModel contains words like 'race', 'concurrent' in parameter classification

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';
import { probeRaceCondition, findRaceCandidates, type RaceProbeConfig, type RaceProbeResult } from './race-probes';

const RACE_SYSTEM_PROMPT = `You are a race condition (TOCTOU) specialist. Your job is to determine if any POST endpoint on the target has a check-then-act pattern that can be exploited with concurrent requests.

## Output (call conclude when done)
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "vulnerability": "<balance-race|coupon-race|invite-race|upload-race|voting-race|generic-race|none>",
  "evidence": ["<parallel request count, success rate, sample responses>"],
  "payloads": ["<the request body used in parallel>"],
  "summary": "<one paragraph>"
}

## Available tools (deterministic, no LLM needed)
- race_find_candidates: inspect app-model.endpoints, return POST endpoints with transfer/coupon/invite/file params
- race_probe: fire N parallel requests against one endpoint, return success rate
- conclude: emit the verdict

## Approach
1. Call race_find_candidates. It will list all POST endpoints with race-prone params.
2. For each candidate (start with the highest-value, e.g. /api/transfer), call race_probe with parallel=10.
3. If successCount > 1, the race is exploitable. Quote the success rate and sample responses.
4. If successCount == 1, the operation is properly serialized. Move on.
5. Call conclude() with the verdict.

## Style rules
- Never use "exploit", "attack", "payload", "injection". Use "test", "probe", "check".
- Quote success counts and sample responses verbatim.`;

export async function runRaceScan(
  appModel: AppModel,
  target: string,
  authToken?: string,
  parallel: number = 10,
): Promise<{ candidates: Array<{ path: string; method: string; body: Record<string, unknown> }>; results: RaceProbeResult[] }> {
  const candidates = findRaceCandidates(appModel);
  const results: RaceProbeResult[] = [];
  for (const c of candidates) {
    const config: RaceProbeConfig = { target, endpoint: c, authToken, parallel };
    results.push(await probeRaceCondition(config));
  }
  return { candidates, results };
}

export const raceSpecialist: SpecialistFactory = {
  name: 'race-specialist',
  description: 'Race condition (TOCTOU): balance/coupon/invite/upload/voting races via parallel requests.',
  build: (tools) => {
    const findTool = {
      name: 'race_find_candidates',
      description: 'Find POST endpoints with race-prone params (amount, balance, coupon, code, file, etc.)',
      invoke: async (input: { appModel: AppModel }) => {
        return JSON.stringify(findRaceCandidates(input.appModel));
      },
    };
    const probeTool = {
      name: 'race_probe',
      description: 'Fire N parallel requests at a single endpoint, return success rate',
      invoke: async (input: RaceProbeConfig) => {
        return JSON.stringify(await probeRaceCondition(input));
      },
    };
    return {
      name: 'race-specialist',
      description: 'Race condition (TOCTOU): balance/coupon/invite/upload/voting races via parallel requests.',
      systemPrompt: RACE_SYSTEM_PROMPT,
      tools: [findTool, probeTool, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude],
    };
  },
  shouldInclude: (appModel: AppModel) => {
    const RACE_PARAM = /^(amount|balance|withdraw|transfer|price|coupon|code|invite|file|claim|vote|points|credit|score|deposit)$/i;
    return (appModel.endpoints || []).some((e) =>
      e.method === 'POST' && (e.bodyFields || []).some((f) => RACE_PARAM.test(f.name)),
    );
  },
};
