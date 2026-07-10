# SPEC-01-003: Auth Decode & Reuse Detector

**Status:** 📋 Planned  
**Phase:** 01 - Business-Logic Analyser  
**Priority:** P1  
**Date:** 2026-07-09  
**Depends On:** SPEC-01-001

---

## 1. Problem Statement

Auth headers are captured but never decoded. A `Basic dXNlcjpwYXNz` or JWT is sent on every request yet the system never notices that the same credential appears on `/user/1` and `/user/2`, or that the JWT `role` claim is trusted server-side. This is where BOLA/BFLA lives.

---

## 2. Acceptance Criteria

~~~
AC-01-003-1: decodeAndTrack() decodes Basic/JWT/Bearer and writes an AuthScheme node
AC-01-003-2: Reused credentials across multiple endpoints are flagged (BOLA risk)
AC-01-003-3: JWT role/admin claims are detected and a role-escalation hypothesis is emitted
AC-01-003-4: No secret is logged in cleartext (mask credential)
~~~

---

## 3. Technical Design

New `src/analysis/auth-decode.ts`:
~~~
export class AuthDecodeDetector {
  decodeAndTrack(header: string, endpoint: string): AuthSchemeInfo | null {
    if (header.startsWith('Basic ')) { /* base64 -> user:pass, hash, track reuse */ }
    if (header.startsWith('Bearer ') && looksLikeJwt(h)) { /* decode payload, detect roles */ }
    return scheme;
  }
  findReusableCredentials(): { credentialHash: string; endpoints: string[] }[] { /* group by hash */ }
}
~~~

Integrate into httpRequest: call `decodeAndTrack` on the Authorization header of each response/request pair.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/analysis/auth-decode.ts` | NEW | ~160 |
| `src/tools/http-tools.ts` | Call decodeAndTrack on auth header | ~10 |

---

## 5. Tests

- `test/analysis/auth-decode.test.ts`: decodes Basic + JWT; flags reuse across two endpoints; masks secret.

---

*Spec Version: 1.0*
