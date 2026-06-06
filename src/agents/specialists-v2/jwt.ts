// src/agents/specialists-v2/jwt.ts
// JWT specialist: alg=none, alg-confusion, kid injection, weak secrets,
// role escalation. Full implementation includes concrete bypass tests.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are a JWT security specialist. Your job is to determine if a JWT-protected endpoint is vulnerable to:

1. alg=none bypass: replace header alg with "none", remove signature, send. If 200 with admin data, CRITICAL.
2. alg confusion: take RS256 token, sign with HS256 using the public key as secret.
3. kid injection: "kid": "../../../dev/null" or "kid": "key1" with SQLi to pick a different key.
4. Weak secret: HS256 with a guessable key like "secret", "key", "".
5. Missing signature verification.
6. Role escalation: decode payload, modify "role" or "admin" claim, re-sign if key known.

For each probe, capture the response. Concrete evidence: status code 200 with admin-only data after sending a modified token, vs status 401/403 with the legitimate token.`;

const TOOL_NAMES = ['httpRequest', 'scratchpadWrite', 'scratchpadRead', 'conclude'];

export const jwtSpecialist: SpecialistFactory = {
  name: 'jwt',
  description: 'JWT alg=none, alg confusion, kid injection, weak secrets, role escalation.',
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
  build: (tools) => ({
    name: 'jwt',
    description: 'JWT alg=none, alg confusion, kid injection, weak secrets, role escalation.',
    systemPrompt: SYSTEM_PROMPT,
    tools: TOOL_NAMES.map((n) => tools[n as keyof typeof tools]).filter(Boolean) as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  }),
};
