// tests/recon/jwt-discovery.test.ts
import { describe, it, expect } from 'vitest';
import { runJwtDiscovery, looksLikeJwt } from '../../src/recon/jwt-discovery';
import { readAppModel, writeAppModelAsync, DEFAULT_MODEL } from '../../src/core/app-model';
import { makeTempModelPath, cleanup } from './recon-helpers';
import crypto from 'crypto';

function b64url(o: object) {
  return Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJwt(header: object, payload: object, sig = 'sig') {
  return `${b64url(header)}.${b64url(payload)}.${sig}`;
}

describe('looksLikeJwt', () => {
  it('accepts a real 3-part base64url token', () => {
    const tok = makeJwt({ alg: 'HS256', typ: 'JWT' }, { sub: 1 });
    expect(looksLikeJwt(tok)).toBe(true);
  });
  it('strips Bearer prefix', () => {
    const tok = makeJwt({ alg: 'HS256' }, {});
    expect(looksLikeJwt(`Bearer ${tok}`)).toBe(true);
  });
  it('rejects non-JWT strings', () => {
    expect(looksLikeJwt('not-a-jwt')).toBe(false);
    expect(looksLikeJwt('a.b')).toBe(false);
    expect(looksLikeJwt('a.b.c.d')).toBe(false);
  });
});

describe('runJwtDiscovery', () => {
  it('decodes a JWT from a cookie and marks alg=none as vulnerable', async () => {
    const p = await makeTempModelPath();
    try {
      const tok = makeJwt({ alg: 'none', typ: 'JWT' }, { sub: 3, role: 'admin' });
      const model = { ...DEFAULT_MODEL, cookies: { auth: tok } };
      await writeAppModelAsync(p, model);
      const result = await runJwtDiscovery(p);
      expect(result.tokens.length).toBe(1);
      const t = result.tokens[0];
      expect(t.algorithm).toBe('none');
      expect(t.algorithmVulnerable).toBe(true);
      expect((t.payload as any).role).toBe('admin');
      expect(t.source).toBe('cookie');
    } finally { await cleanup(p); }
  });

  it('decodes a JWT from localStorage', async () => {
    const p = await makeTempModelPath();
    try {
      const tok = makeJwt({ alg: 'HS256' }, { sub: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
      await writeAppModelAsync(p, { ...DEFAULT_MODEL, localStorage: { jwt: tok } });
      const result = await runJwtDiscovery(p);
      expect(result.tokens.length).toBe(1);
      expect(result.tokens[0].source).toBe('localStorage');
      expect(result.tokens[0].isExpired).toBe(false);
    } finally { await cleanup(p); }
  });

  it('flags expired tokens', async () => {
    const p = await makeTempModelPath();
    try {
      const tok = makeJwt({ alg: 'HS256' }, { sub: 1, exp: 1 });
      await writeAppModelAsync(p, { ...DEFAULT_MODEL, cookies: { t: tok } });
      const result = await runJwtDiscovery(p);
      expect(result.tokens[0].isExpired).toBe(true);
    } finally { await cleanup(p); }
  });

  it('returns empty when no JWT-shaped cookies/tokens', async () => {
    const p = await makeTempModelPath();
    try {
      await writeAppModelAsync(p, { ...DEFAULT_MODEL, cookies: { session: 'abc123' } });
      const result = await runJwtDiscovery(p);
      expect(result.tokens).toEqual([]);
    } finally { await cleanup(p); }
  });
});
