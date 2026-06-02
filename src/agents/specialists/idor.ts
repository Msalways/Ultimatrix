/**
 * src/agents/specialists/idor.ts
 *
 * IDOR (Insecure Direct Object Reference) specialist — probes for
 * missing authorization on resource-fetching endpoints by enumerating
 * sequential IDs and comparing response bodies/lengths.
 *
 * Selection heuristic: include when any parameter looks like an ID
 * (id, userId, accountId, memberId, etc.) or path matches /:id pattern.
 */

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';

const IDOR_SYSTEM_PROMPT = `You are an Insecure Direct Object Reference (IDOR) specialist. Your job is to determine if a web endpoint enforces authorization on object access.

## Output
You MUST call conclude() with the result. Schema:
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "affectedResources": ["<IDs that leaked>"],
  "evidence": ["<verbatim response fragments showing unauthorized access>"],
  "payloads": ["<IDs/URLs tried>"],
  "summary": "<one paragraph>"
}

## Approach
1. Establish a baseline: request the target with the legitimate ID. observe_response.
2. If the endpoint has auth, observe whether removing the auth header changes the response.
3. Enumerate neighbor IDs (e.g. +1, -1, +10, -10, 0, large numbers) and compare:
   - Same response length + same shape -> likely leaked
   - Different shape -> authorized correctly
   - 401/403 -> authorized
   - 200 with object fields you can read -> VULNERABLE
4. For path-style IDs (/users/123, /orders/456), change only the ID.
5. For query-style IDs (?id=1, ?userId=2), change only the param.
6. Note: a 200 response with a structured body containing the resource data is stronger evidence than just status code.
7. If neighbor IDs all return 404/403, the endpoint IS authorized. Set vulnerable=false.

## Style rules
- Never use "exploit", "attack", "payload", "injection". Use "test", "probe", "check".
- Quote response fragments verbatim. Be specific about what leaked.`;

export const idorSpecialist: SpecialistFactory = {
  name: 'idor-specialist',
  description: 'IDOR via numeric ID enumeration, response body comparison, auth header removal.',
  build: (tools) => ({
    name: 'idor-specialist',
    description: 'IDOR via numeric ID enumeration, response body comparison, auth header removal.',
    systemPrompt: IDOR_SYSTEM_PROMPT,
    tools: [tools.httpRequest, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude],
  }),
  shouldInclude: (appModel: AppModel) => {
    const hasIdParam = (appModel.parameterClassifications || []).some((c) => c.classifiedAs === 'id');
    const hasPathId = (appModel.endpoints || []).some((e) => /\/:\w+|\/{\w+}|\/\d+\b/.test(e.path));
    const hasAuthedEndpoint = (appModel.endpoints || []).some((e) => e.requiresAuth);
    return hasIdParam || hasPathId || hasAuthedEndpoint;
  },
};
