// src/agents/specialists/oauth.ts
//
// OAuth 2.0 / OIDC specialist — tests for:
//   1. redirect_uri prefix-bypass (open redirect → code theft)
//   2. state fixation / missing state (CSRF on auth flow)
//   3. scope escalation (request more scopes than granted)
//   4. response_type confusion (token instead of code)
//   5. PKCE downgrade
//
// Selection heuristic: include when:
//   - Any oauth provider is discovered in appModel.oauthProviders
//   - Any endpoint has /oauth/, /authorize, or /.well-known/openid-configuration
//   - auth.type === 'oauth'

import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory } from './types';
import { probeRedirectUriPrefixBypass, probeStateMissing, probeScopeEscalation, probeResponseTypeConfusion, probePkceDowngrade, type OAuthProbeConfig, type ProbeResult } from './oauth-probes';

const OAUTH_SYSTEM_PROMPT = `You are an OAuth 2.0 / OIDC security specialist. Your job is to determine if an OAuth flow on the target is vulnerable to redirect_uri bypass, state fixation, scope escalation, response_type confusion, or PKCE downgrade.

## Output (call conclude when done)
{
  "vulnerable": boolean,
  "confidence": <0-1>,
  "vulnerability": "<redirect-bypass|state-fixation|scope-escalation|response-type-confusion|pkce-downgrade|none>",
  "evidence": ["<response status codes, locations, payload strings>"],
  "payloads": ["<the test redirect_uris and scopes>"],
  "summary": "<one paragraph>"
}

## Available tools (deterministic, no LLM needed)
- oauth_run_all_probes: runs all 5 OAuth probes in parallel and returns a combined result. ALWAYS call this first.
- http_request: for follow-up probes if needed.
- scratchpad_write/read: store the result
- conclude: emit the final verdict

## Approach
1. Call oauth_run_all_probes ONCE. The tool runs all 5 probes in parallel against the discovered OAuth provider.
2. Read the combined result. If any probe returned vulnerable=true, summarize the highest-severity finding.
3. If a probe returned vulnerable=false, you can try one follow-up http_request to confirm, but only if it would add evidence.
4. Quote the response locations and status codes verbatim in your evidence.
5. Call conclude() with the verdict.

## Style rules
- Never use "exploit", "attack", "payload", "injection". Use "test", "probe", "check".
- Reference exact response locations and status codes.
- If multiple probes succeed, pick the most severe (redirect-bypass > scope-escalation > state-fixation > response-type > pkce).`;

// ── deterministic "run all probes" tool ───────────────────────────────────

export async function runAllOAuthProbes(
  config: OAuthProbeConfig,
): Promise<{
  results: ProbeResult[];
  summary: {
    vulnerable: boolean;
    highestSeverity: ProbeResult['severity'];
    techniques: string[];
  };
}> {
  const results = await Promise.all([
    probeRedirectUriPrefixBypass(config),
    probeStateMissing(config),
    probeScopeEscalation(config),
    probeResponseTypeConfusion(config),
    probePkceDowngrade(config),
  ]);
  const vulnerable = results.some(r => r.vulnerable);
  const severities: ProbeResult['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];
  const highest = results
    .filter(r => r.vulnerable)
    .map(r => r.severity)
    .reduce((a, b) => (severities.indexOf(a) < severities.indexOf(b) ? a : b), 'info' as ProbeResult['severity']);
  return {
    results,
    summary: {
      vulnerable,
      highestSeverity: vulnerable ? highest : 'info',
      techniques: results.filter(r => r.vulnerable).map(r => r.technique),
    },
  };
}

export const oauthSpecialist: SpecialistFactory = {
  name: 'oauth-specialist',
  description: 'OAuth 2.0 / OIDC: redirect_uri bypass, state fixation, scope escalation, response_type confusion, PKCE downgrade.',
  build: (tools) => {
    const oauthProbeTool = {
      name: 'oauth_run_all_probes',
      description: 'Run all 5 OAuth probes in parallel against the discovered provider. Returns structured results for each.',
      invoke: async (input: { config: OAuthProbeConfig }) => {
        return JSON.stringify(await runAllOAuthProbes(input.config));
      },
    };
    return {
      name: 'oauth-specialist',
      description: 'OAuth 2.0 / OIDC: redirect_uri bypass, state fixation, scope escalation, response_type confusion, PKCE downgrade.',
      systemPrompt: OAUTH_SYSTEM_PROMPT,
      tools: [oauthProbeTool, tools.httpRequest, tools.scratchpadWrite, tools.scratchpadRead, tools.conclude],
    };
  },
  shouldInclude: (appModel: AppModel) => {
    if ((appModel.oauthProviders || []).length > 0) return true;
    if (appModel.auth?.type === 'oauth') return true;
    return (appModel.endpoints || []).some((e) =>
      /\/(oauth|authorize|callback|token|\.well-known\/openid-configuration)/i.test(e.path || '')
    );
  },
};
