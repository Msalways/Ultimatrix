/**
 * POST /api/spider/approve — approve a proposed scope origin (slice 03).
 *
 * The spider classifies discovered URLs as `allowed` | `proposed` | `denied`.
 * Proposed URLs are surfaced but never auto-executed. This endpoint lets the
 * user explicitly approve one, which expands the live boundary (reclassifying
 * already-discovered proposed items from that origin) and remembers it for
 * subsequent crawls on the engine.
 */

import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { target, url } = await req.json()
    if (!target || !url) {
      return new Response(JSON.stringify({ error: 'target and url are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const engine = targetManager.getEngine(target)
    if (!engine) {
      return new Response(JSON.stringify({ error: `No engine for target: ${target}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = engine.approveProposed(url)
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
