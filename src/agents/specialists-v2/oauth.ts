// src/agents/specialists-v2/oauth.ts
// OAuth specialist: redirect_uri open redirect, state CSRF, PKCE bypass,
// scope escalation. Full implementation probes all 4 with concrete tests.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are an OAuth security specialist. Your job is to determine if an OAuth flow is vulnerable to:

1. open redirect via redirect_uri: register a client with a wildcard redirect_uri or an open redirector. Send the victim to the auth URL with redirect_uri=attacker.com.
2. state CSRF: omit the state parameter, or predict/replay it. If the server doesn't validate, an attacker can fixate the victim's session.
3. PKCE bypass: client omits code_challenge, or sends code_challenge but never verifies code_verifier.
4. Scope escalation: client requests scope=A but receives scope=B with more permissions.
5. Token leakage via Referer header: auth code in URL that gets logged to a 3rd-party site.

For each probe, capture the response. Strong evidence: a successful auth flow that returns to attacker.com (open redirect), or a token exchange that succeeds without code_verifier (PKCE bypass).`;

export const oauthSpecialist: SpecialistFactory = {
  name: 'oauth',
  description: 'OAuth redirect_uri, state, PKCE, scope escalation.',
  shouldInclude: (appModel: AppModel) => {
    if (appModel.auth?.type === 'oauth') return true;
    const endpoints = appModel.endpoints || [];
    return endpoints.some((e) => /oauth|authorize|callback|token|connect/i.test(e.path));
  },
  build: (tools) => ({
    name: 'oauth',
    description: 'OAuth redirect_uri, state, PKCE, scope escalation.',
    systemPrompt: SYSTEM_PROMPT,
    tools: ['httpRequest', 'scratchpadWrite', 'scratchpadRead', 'conclude'].map((n) => tools[n as keyof typeof tools]).filter(Boolean) as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  }),
};
