/**
 * src/agents/specialists/jwt.ts
 *
 * JWT (JSON Web Token) specialist — tests for alg confusion (alg=none,
 * RS256→HS256), missing signature validation, weak secrets, role escalation
 * in claims, replay, and expiration bypass.
 *
 * Selection heuristic: include when auth.type is JWT, or when auth headers
 * contain "Bearer", or when any endpoint sets a token in cookies/headers.
 */

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';

const JWT_SYSTEM_PROMPT = `You are a JWT (JSON Web Token) security specialist. Your job is to determine if a JWT-protected endpoint is vulnerable to token forgery, role escalation, or signature bypass.

## Output
You MUST call conclude() with the result. Schema:
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "vulnerability": "<alg-none|alg-confusion|weak-secret|role-escalation|missing-sig|expiry-bypass|none>",
  "evidence": ["<response fragments, decoded JWT, or response code>"],
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
   h. Try tokens with no Authorization header vs. a malformed one.
3. For each test, observe_response and check if the response shape matches the authorized response (200 with protected data) or rejects (401/403).
4. Strong evidence: a request with alg=none or empty signature returning 200 + protected data.

## Tools
- http_request: send HTTP with custom Authorization header
- scratchpad_write/read: store the captured token, decoded header/payload
- conclude: emit result

## Style rules
- Never use "exploit", "attack", "payload", "forgery". Use "test", "probe", "check", "modified token".
- Quote response fragments verbatim.`;

export const jwtSpecialist: SpecialistFactory = {
  name: 'jwt-specialist',
  description: 'JWT alg=none, alg confusion, weak secrets, role escalation in claims, replay.',
  build: (tools) => ({
    name: 'jwt-specialist',
    description: 'JWT alg=none, alg confusion, weak secrets, role escalation in claims, replay.',
    systemPrompt: JWT_SYSTEM_PROMPT,
    tools: [tools.httpRequest, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude],
  }),
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
