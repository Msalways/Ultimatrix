// src/agents/specialists-v2/idor.ts
// IDOR/BOLA specialist. Uses multi-session pool to verify that user B
// can access user A's resources by changing the ID/path component.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are an IDOR/BOLA (Insecure Direct Object Reference / Broken Object Level Authorization) specialist.

Approach:
1. list_sessions to see what authenticated sessions are available.
2. As user-a, GET /api/users/a/profile. Note the response.
3. As user-a, GET /api/users/b/profile. If the response contains user-b's data, IDOR is confirmed.
4. Try variants: /api/users/{id}, /api/orders/{orderId}, /api/messages/{msgId}.
5. Strong evidence: user-a receives user-b's data with a 200 status, and the body content is user-b's (e.g., user-b's email, address).

Tools:
- list_sessions, switch_session, login_session
- httpRequest with the active session's cookies
- diff_sessions to see both responses side-by-side
- screenshot_session to capture DOM if HTML
- conclude to write the finding

Output (conclude):
{ vulnerable: true, evidence: ["as user-a GET /api/users/b/profile -> 200, body contains user-b's email 'bob@example.com'"] }`;

export const idorSpecialist: SpecialistFactory = {
  name: 'idor',
  description: 'IDOR/BOLA: cross-tenant access. Verified via multi-session diff.',
  shouldInclude: (appModel: AppModel) => {
    if ((appModel.endpoints || []).length === 0) return false;
    const hasPathParams = (appModel.endpoints || []).some((e) => /\{[^}]+\}/.test(e.path) || /\/:/.test(e.path));
    const hasUsers = (appModel.endpoints || []).some((e) => /user|account|profile|order|invoice|message/i.test(e.path));
    return hasPathParams || hasUsers;
  },
  build: (tools) => {
    const baseTools = ['httpRequest', 'scratchpadWrite', 'scratchpadRead', 'conclude'].map((n) => tools[n as keyof typeof tools]).filter(Boolean);
    const poolTools = (tools as unknown as { poolTools?: Record<string, { name: string; description: string; schema: Record<string, unknown> }> }).poolTools;
    const extra = poolTools ? ['listSessions', 'switchSession', 'loginSession', 'diffSessions', 'screenshotSession'].map((n) => poolTools[n]).filter(Boolean) : [];
    return {
      name: 'idor',
      description: 'IDOR/BOLA: cross-tenant access. Verified via multi-session diff.',
      systemPrompt: SYSTEM_PROMPT,
      tools: [...baseTools, ...extra] as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
    };
  },
};
