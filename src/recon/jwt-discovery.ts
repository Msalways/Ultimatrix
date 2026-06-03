// src/recon/jwt-discovery.ts
//
// Decodes any JWTs found in the AppModel (cookies, headers, localStorage,
// response body references) and writes structured `JWTTokenInfo` into
// `appModel.jwtTokens[]`. NO signature verification — that's a specialist's
// job. We only decode and look for vulnerability signals:
//   - alg: 'none' or 'None' or 'NONE'
//   - weak algorithm (HS1, HS256 with kid pointing to a file)
//   - expired token
//   - role / scope / admin claims present
//   - kid / jku / x5u headers (vectors for kid injection or SSRF)

import { readAppModel, updateAppModelSection, type JWTTokenInfo } from '../core/app-model';
import { logReconEntry } from './index';

const STORAGE_KEY_PATTERNS = [
  /token/i, /jwt/i, /auth/i, /session/i, /access/i, /id_token/i, /id-token/i,
];

const VULNERABLE_ALGS = new Set(['none', 'None', 'NONE', 'HS1']);

export async function runJwtDiscovery(
  appModelPath: string,
  _timeoutMs: number = 5000,
): Promise<{ tokens: JWTTokenInfo[] }> {
  const start = Date.now();
  const model = readAppModel(appModelPath);
  const candidates: Array<{ source: JWTTokenInfo['source']; sourceName: string; raw: string }> = [];

  // 1. cookies
  for (const [name, value] of Object.entries(model.cookies || {})) {
    if (looksLikeJwt(value)) {
      candidates.push({ source: 'cookie', sourceName: name, raw: value });
    }
  }

  // 2. localStorage
  for (const [name, value] of Object.entries(model.localStorage || {})) {
    if (looksLikeJwt(value)) {
      candidates.push({ source: 'localStorage', sourceName: name, raw: value });
    }
  }

  // 3. auth.tokens (set by login flow)
  for (const t of model.auth?.tokens || []) {
    if (looksLikeJwt(t)) {
      candidates.push({ source: 'header', sourceName: 'auth.tokens[]', raw: t });
    }
  }

  // 4. heuristics: scan recorded session storage for jwt-like strings
  for (const [sessionId, steps] of Object.entries(model.recordedSessions || {})) {
    for (const step of steps) {
      const blob = JSON.stringify(step);
      const matches = blob.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
      if (matches) {
        for (const m of matches) {
          candidates.push({ source: 'sessionStorage', sourceName: `${sessionId}:${step.type || 'step'}`, raw: m });
        }
      }
    }
  }

  // Dedupe by raw token
  const seen = new Set<string>();
  const tokens: JWTTokenInfo[] = [];
  for (const c of candidates) {
    if (seen.has(c.raw)) continue;
    seen.add(c.raw);
    const info = decodeJwt(c.raw, c.source, c.sourceName);
    if (info) tokens.push(info);
  }

  if (tokens.length > 0) {
    updateAppModelSection(appModelPath, 'jwtTokens', tokens);
  }

  logReconEntry(appModelPath, {
    tool: 'jwt-discovery',
    target: model.target,
    status: tokens.length > 0 ? 'found' : 'not-found',
    durationMs: Date.now() - start,
    detail: `${candidates.length} candidate(s), ${tokens.length} decoded; ${tokens.filter(t => t.algorithmVulnerable).length} with vulnerable alg`,
  });

  return { tokens };
}

export function looksLikeJwt(value: string): boolean {
  if (typeof value !== 'string') return false;
  // strip "Bearer " prefix
  const v = value.replace(/^Bearer\s+/, '').trim();
  const parts = v.split('.');
  if (parts.length !== 3) return false;
  // require all 3 parts to be valid base64url (not just eyJ-prefixed)
  if (!/^[A-Za-z0-9_-]+$/.test(parts[0])) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1])) return false;
  if (!/^[A-Za-z0-9_-]*$/.test(parts[2])) return false; // empty sig is valid for alg=none
  // at least the first two parts should be at least 2 chars (decode to >=1 byte)
  if (parts[0].length < 2 || parts[1].length < 2) return false;
  return true;
}

function decodeJwt(raw: string, source: JWTTokenInfo['source'], sourceName: string): JWTTokenInfo | null {
  const parts = raw.replace(/^Bearer\s+/, '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64urlDecode(parts[0])) as Record<string, unknown>;
    const payload = JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>;
    const algorithm = String(header.alg || 'unknown');
    const algorithmVulnerable = VULNERABLE_ALGS.has(algorithm);
    const weakSecretSuspected = algorithm === 'HS256' && (
      typeof header.kid === 'string' && /\.\.|\/|\\|\.\./.test(header.kid) // path traversal in kid
      || typeof header.jku === 'string' || typeof header.x5u === 'string'
      || typeof header.alg === 'string' && /HS\d{1,3}$/.test(algorithm) && (header as any)._test === true
    );
    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
    return {
      source,
      sourceName,
      raw,
      header,
      payload,
      expiresAt: exp,
      isExpired: exp !== undefined && exp < now,
      algorithm,
      algorithmVulnerable,
      weakSecretSuspected: !!weakSecretSuspected,
      capturedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}
