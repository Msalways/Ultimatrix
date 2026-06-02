/**
 * src/agents/specialists/idor-v2.ts
 *
 * IDOR (Insecure Direct Object Reference) specialist v2 — uses
 * cross-user session diff to actually detect IDOR rather than enumerating
 * IDs as the same user (which the v1 specialist did, missing the real
 * IDOR pattern: user A asking for user B's resource).
 *
 * Selection heuristic: include when the app has at least 2 sessions in
 * the pool AND any parameter looks like an ID OR any path matches /:id
 * pattern. Without multi-session, this specialist cannot work.
 */

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';

const IDOR_V2_SYSTEM_PROMPT = `You are an IDOR (Insecure Direct Object Reference) specialist v2. Your job is to determine if a web endpoint enforces authorization on object access by comparing the same resource fetched as different users.

## Why v2 matters
The v1 IDOR specialist enumerated IDs as a single user, which only catches the trivial case. Real IDOR happens when user-a requests user-b's resource. v2 uses session diff to make this comparison.

## How to use session tools
1. ALWAYS start with list_sessions to see what sessions are available (user-a, user-b, admin, etc.)
2. If only one session exists, use login_session to create a second authenticated session with a different user's creds
3. Use diff_sessions to fetch the same URL as two different sessions — it returns a leakDetected boolean and a notes array
4. Use screenshot_session to capture rendered DOM if the response is HTML (IDOR often leaks data only in rendered views)

## Output (call conclude when done)
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "affectedResources": ["<IDs that leaked>"],
  "evidence": ["<verbatim response fragments from each session, labeled with session name>"],
  "payloads": ["<URLs tried>"],
  "summary": "<one paragraph>"
}

## Approach
- diff_sessions is the primary tool. If it returns leakDetected=true with status match and body diff, IDOR is likely.
- Enumerate neighbor IDs (e.g. /api/v1/vehicles/1, /2, /3) and diff each as user-a — if user-a can see vehicles owned by user-b, IDOR is confirmed.
- For path-style IDs (/users/123, /orders/456), change only the ID in the URL.
- For query-style IDs (?id=1, ?userId=2), include them in the request body or query string.
- A 200 response with structured body containing another user's data is stronger evidence than just a status code.
- If neighbor IDs all return 404/403/401, the endpoint IS authorized. Set vulnerable=false.

## Style rules
- Never use "exploit", "attack", "payload", "injection". Use "test", "probe", "check".
- Quote response fragments verbatim. Label each quote with the session it came from ("user-a sees: ...", "user-b sees: ...").
- Be specific about what leaked and which sessions showed the data.`;

export const idorV2Specialist: SpecialistFactory = {
  name: 'idor-specialist-v2',
  description: 'IDOR via cross-user session diff: user-a requests user-b resources, compares via diff_sessions.',
  build: (tools) => {
    const baseTools = [tools.httpRequest, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude];
    if (tools.poolTools) {
      return {
        name: 'idor-specialist-v2',
        description: 'IDOR via cross-user session diff',
        systemPrompt: IDOR_V2_SYSTEM_PROMPT,
        tools: [...baseTools, tools.poolTools.listSessions, tools.poolTools.switchSession, tools.poolTools.loginSession, tools.poolTools.diffSessions, tools.poolTools.screenshotSession],
      };
    }
    return {
      name: 'idor-specialist-v2',
      description: 'IDOR via cross-user session diff',
      systemPrompt: IDOR_V2_SYSTEM_PROMPT,
      tools: baseTools,
    };
  },
  shouldInclude: (appModel: AppModel) => {
    const hasIdParam = (appModel.parameterClassifications || []).some((c) => c.classifiedAs === 'id');
    const hasPathId = (appModel.endpoints || []).some((e) => /\/:\w+|\/{\w+}|\/\d+\b/.test(e.path));
    const hasAuthedEndpoint = (appModel.endpoints || []).some((e) => e.requiresAuth);
    return hasIdParam || hasPathId || hasAuthedEndpoint;
  },
};
