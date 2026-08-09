/**
 * Web UI authentication — bearer token for remote access.
 *
 * When the server binds to localhost (127.0.0.1), no auth is required.
 * When bound to a non-loopback interface (0.0.0.0), a random token is
 * generated at startup and required for all API requests.
 *
 * Token is passed via:
 *   - Authorization: Bearer <token> header
 *   - ?token=<token> query parameter (for SSE/streaming endpoints)
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

let _authToken: string | null = null
let _authRequired = false

/** Generate a new random auth token (32 hex chars). */
export function generateAuthToken(): string {
  return randomBytes(16).toString('hex')
}

/** Set the auth token and whether auth is required. Called at startup. */
export function initAuth(token: string | null, required: boolean): void {
  _authToken = token
  _authRequired = required
}

/** Is auth currently required? */
export function isAuthRequired(): boolean {
  return _authRequired && _authToken !== null
}

/** Get the current auth token (for display). */
export function getAuthToken(): string | null {
  return _authToken
}

/** Mask a token for safe display — show only last 4 chars. */
export function maskToken(token: string): string {
  if (!token) return ''
  return `****${token.slice(-4)}`
}

/**
 * Validate a request's auth. Returns true if:
 * - Auth is not required (localhost mode), OR
 * - The provided token matches (constant-time comparison).
 *
 * @param headerToken - Value from Authorization: Bearer <token>
 * @param queryToken  - Value from ?token=<token>
 */
export function validateAuth(headerToken?: string | null, queryToken?: string | null): boolean {
  if (!_authRequired || !_authToken) return true

  const candidate = headerToken || queryToken
  if (!candidate) return false

  // Constant-time comparison to prevent timing attacks
  try {
    const expected = Buffer.from(_authToken, 'utf-8')
    const actual = Buffer.from(candidate, 'utf-8')
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
