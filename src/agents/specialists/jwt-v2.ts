/**
 * src/agents/specialists/jwt-v2.ts
 *
 * JWT (JSON Web Token) specialist v2 — uses session diff to actually
 * verify that a forged token grants access the legitimate user would
 * not have. v1 only modified tokens in isolation; v2 cross-checks by
 * logging in as a different role and seeing if a token with the modified
 * claim actually returns admin-only data.
 *
 * Selection heuristic: include when auth.type is JWT, or when auth
 * headers contain "Bearer", or when any endpoint sets a token in
 * cookies/headers.
 */

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';

const JWT_V2_SYSTEM_PROMPT = `You are a JWT (JSON Web Token) security specialist v2. Your job is to determine if a JWT-protected endpoint is vulnerable to token forgery, role escalation, or signature bypass — and to use session diff to confirm the bypass actually grants access the legitimate user wouldn't have.

## Why v2 matters
v1 forged tokens in isolation. v2 cross-checks by using diff_sessions: log in as user-a, get a token, modify the role claim, replay as user-a, then diff against admin's view of the same endpoint. If modified-user-a sees admin-only data, the bypass is real.

## How to use session tools
1. list_sessions to see what authenticated sessions are available
2. switch_session to change which session is making the request
3. diff_sessions to compare what different roles see at the same URL
4. login_session to capture a fresh JWT or cookie as a different user
5. screenshot_session to capture DOM if the response is HTML

## Output (call conclude when done)
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "vulnerability": "<alg-none|alg-confusion|weak-secret|role-escalation|missing-sig|expiry-bypass|none>",
  "evidence": ["<verbatim token fragments, response status/body, diff_sessions notes>"],
  "payloads": ["<forged tokens or test strings>"],
  "summary": "<one paragraph>"
}

## Approach
1. Capture a legitimate JWT from the Authorization header or Set-Cookie. Use scratchpad_write to store it.
2. Try these probes IN ORDER:
   a. alg=none: replace the header alg with "none", remove the signature, send. If 200 -> critical.
   b. alg=HS256 confusion: take an RS256 token, sign with HS256 using the public key as secret. If 200 -> critical.
   c. Empty signature: keep header/payload, empty signature. Send.
   d. Algorithm-case: try "None", "NONE", "nOnE".
   e. Decode the payload (it's base64url). Look for "role", "admin", "user_id", "sub", "exp" claims.
   f. Modify role to "admin" / "superuser", re-sign with the original key if weak/guessable.
   g. Set exp to a far-future timestamp. Sign if you can.
3. After each modification, use diff_sessions between the original-user-session and a different-user-session to see if the modified token grants cross-role access. If user-a with role-escalated token sees admin-only data, role-escalation is confirmed.
4. Strong evidence: a request with alg=none or empty signature returning 200 + admin-only data, confirmed via diff_sessions.

## Style rules
- Never use "exploit", "attack", "payload", "forgery". Use "test", "probe", "check", "modified token".
- Quote response fragments verbatim. Always include the session attribution ("as user-a with modified token: ...", "as admin: ...").`;

export const jwtV2Specialist: SpecialistFactory = {
  name: 'jwt-specialist-v2',
  description: 'JWT alg=none, alg confusion, weak secrets, role escalation, missing sig — verified via session diff.',
  build: (tools) => {
    const baseTools = [tools.httpRequest, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude];
    if (tools.poolTools) {
      return {
        name: 'jwt-specialist-v2',
        description: 'JWT alg=none, alg confusion, weak secrets, role escalation, missing sig — verified via session diff.',
        systemPrompt: JWT_V2_SYSTEM_PROMPT,
        tools: [...baseTools, tools.poolTools.listSessions, tools.poolTools.switchSession, tools.poolTools.loginSession, tools.poolTools.diffSessions],
      };
    }
    return {
      name: 'jwt-specialist-v2',
      description: 'JWT alg=none, alg confusion, weak secrets, role escalation, missing sig — verified via session diff.',
      systemPrompt: JWT_V2_SYSTEM_PROMPT,
      tools: baseTools,
    };
  },
  shouldInclude: (appModel: AppModel) => {
    if (appModel.auth?.type === 'JWT') return true;
    const hasBearer = (appModel.cookies && Object.keys(appModel.cookies).length > 0) ||
      (appModel.auth?.tokens && appModel.auth.tokens.length > 0);
    if (hasBearer) return true;
    const hasAuthEndpoints = (appModel.endpoints || []).some((e) =>
      Object.keys(e.authHeaders || {}).some((k) => /authorization|cookie/i.test(k))
    );
    return hasAuthEndpoints;
  },
};
