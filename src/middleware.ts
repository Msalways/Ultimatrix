/**
 * Next.js middleware — protects all /api/* routes with bearer token auth.
 *
 * When auth is disabled (localhost mode), all requests pass through.
 * When auth is enabled, requests must include a valid token via:
 *   - Authorization: Bearer <token> header
 *   - ?token=<token> query parameter (for SSE/streaming)
 *
 * The token is set via ULTIMATRIX_AUTH_TOKEN env var at server startup.
 * Static assets and web UI pages are not protected (needed to load the UI).
 */

import { type NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: ['/api/:path*'],
}

export function middleware(req: NextRequest): NextResponse {
  const token = process.env.ULTIMATRIX_AUTH_TOKEN
  const required = process.env.ULTIMATRIX_AUTH_REQUIRED === '1'

  // Auth not required (localhost mode) — pass through
  if (!required || !token) {
    return NextResponse.next()
  }

  // Check Authorization header: Bearer <token>
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const provided = authHeader.slice(7)
    if (provided === token) {
      return NextResponse.next()
    }
  }

  // Check query parameter: ?token=<token> (for SSE/streaming connections)
  const queryToken = req.nextUrl.searchParams.get('token')
  if (queryToken && queryToken === token) {
    return NextResponse.next()
  }

  // No valid token — reject
  return NextResponse.json(
    { error: 'Unauthorized. Provide a valid auth token via Authorization header or ?token= query parameter.' },
    { status: 401 }
  )
}
