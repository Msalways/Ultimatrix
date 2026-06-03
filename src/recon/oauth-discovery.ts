// src/recon/oauth-discovery.ts
//
// Discovers OAuth 2.0 / OIDC configuration on the target by:
//   1. Fetching `/.well-known/openid-configuration` at the target origin
//   2. Following the documented `authorization_endpoint` and `token_endpoint`
//   3. Probing common `/oauth/authorize` and `/oauth/token` paths as a fallback
//   4. Inspecting homepage HTML/scripts for `client_id` references
//
// Writes discovered providers into `appModel.oauthProviders[]`.
//
// Vulnerabilities this enables:
//   - redirect_uri prefix-bypass
//   - state fixation
//   - scope escalation
//   - code theft via open redirect in redirect_uri

import { updateAppModelSection, type AppModel, type OAuthProvider } from '../core/app-model';
import { logReconEntry } from './index';

const COMMON_AUTHORIZE_PATHS = [
  '/.well-known/openid-configuration',
  '/oauth/authorize',
  '/oauth2/authorize',
  '/api/oauth/authorize',
  '/auth/authorize',
  '/login/oauth/authorize',
  '/.well-known/oauth-authorization-server',
];

export async function runOauthDiscovery(
  target: string,
  appModelPath: string,
  timeoutMs: number = 5000,
  customHeaders?: Record<string, string>,
  cookies?: Record<string, string>,
): Promise<{ providers: OAuthProvider[] }> {
  const start = Date.now();
  const origin = new URL(target).origin;
  const providers: OAuthProvider[] = [];

  // Step 1: well-known/openid-configuration
  const wellKnown = await fetchWithTimeout(`${origin}/.well-known/openid-configuration`, timeoutMs, customHeaders, cookies);
  if (wellKnown.status === 200) {
    try {
      const j = JSON.parse(wellKnown.body);
      const provider: OAuthProvider = {
        discoveryUrl: `${origin}/.well-known/openid-configuration`,
        issuer: j.issuer,
        authorizationEndpoint: j.authorization_endpoint,
        tokenEndpoint: j.token_endpoint,
        jwksUri: j.jwks_uri,
        responseTypesSupported: j.response_types_supported || [],
        grantTypesSupported: j.grant_types_supported || [],
        scopesSupported: j.scopes_supported || [],
        clientIds: [],
        registeredClients: [],
        discoveredAt: Date.now(),
        raw: wellKnown.body.slice(0, 4096),
      };
      providers.push(provider);
    } catch {
      // malformed JSON, skip
    }
  }

  // Step 2: probe common authorize paths to discover additional client_id usage
  const probes = await Promise.all(
    COMMON_AUTHORIZE_PATHS
      .filter(p => p !== '/.well-known/openid-configuration')
      .map(async p => {
        const r = await fetchWithTimeout(`${origin}${p}?client_id=probe&response_type=code&redirect_uri=https://example.com/cb`, timeoutMs, customHeaders, cookies);
        return { p, status: r.status, location: r.headers['location'] || '' };
      }),
  );
  const validAuthorize: string[] = [];
  for (const { p, status, location } of probes) {
    if (status === 302 || status === 301 || (status === 400 && location)) {
      validAuthorize.push(p);
    }
  }

  // Step 3: spider homepage + JS bundles for client_id
  const home = await fetchWithTimeout(target, timeoutMs, customHeaders, cookies);
  const clientIds = extractClientIds(home.body);
  for (const cid of clientIds) {
    const provider = providers[0] || createEmptyProvider(origin, target);
    if (!provider.clientIds.includes(cid)) {
      provider.clientIds.push(cid);
      provider.registeredClients.push({ clientId: cid, discoveredAt: Date.now(), source: 'spider' });
    }
    if (!providers.includes(provider)) providers.push(provider);
  }

  // Step 4: try author URL with discovered client_ids to enumerate redirect_uri
  for (const provider of providers) {
    for (const cid of provider.clientIds) {
      const r = await fetchWithTimeout(
        `${provider.authorizationEndpoint || `${origin}/oauth/authorize`}?client_id=${encodeURIComponent(cid)}&response_type=code&redirect_uri=https://attacker.test/cb&state=abc`,
        timeoutMs, customHeaders, cookies,
      );
      const loc = r.headers['location'] || '';
      // vulnerability signal: server redirected to attacker.test with code=
      if (loc.includes('attacker.test') && loc.includes('code=')) {
        provider.registeredClients.push({ clientId: cid + '::attacker-redirect', discoveredAt: Date.now(), source: 'spider' });
      }
    }
  }

  if (providers.length > 0) {
    updateAppModelSection(appModelPath, 'oauthProviders', providers);
  }

  logReconEntry(appModelPath, {
    tool: 'oauth-discovery',
    target,
    status: providers.length > 0 ? 'found' : (wellKnown.status !== 0 ? 'not-found' : 'error'),
    durationMs: Date.now() - start,
    detail: `${providers.length} provider(s), ${validAuthorize.length} authorize paths, ${clientIds.length} client_id(s)`,
  });

  return { providers };
}

function createEmptyProvider(origin: string, target: string): OAuthProvider {
  return {
    discoveryUrl: '',
    clientIds: [],
    registeredClients: [],
    discoveredAt: Date.now(),
    authorizationEndpoint: `${origin}/oauth/authorize`,
  };
}

function extractClientIds(html: string): string[] {
  const ids = new Set<string>();
  // common patterns: client_id="foo", clientId: 'foo', client_id=foo
  const re = /client[_]?id\s*[:=]\s*["']([a-zA-Z0-9_.-]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) ids.add(m[1]);
  return Array.from(ids);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  customHeaders?: Record<string, string>,
  cookies?: Record<string, string>,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { 'user-agent': 'ultimatrix-recon/1.0', ...(customHeaders || {}) };
  if (cookies && Object.keys(cookies).length > 0) {
    headers['cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  try {
    const r = await fetch(url, { signal: controller.signal, headers, redirect: 'manual' });
    const body = await r.text();
    const h: Record<string, string> = {};
    r.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    return { status: r.status, body, headers: h };
  } catch {
    return { status: 0, body: '', headers: {} };
  } finally {
    clearTimeout(timer);
  }
}
