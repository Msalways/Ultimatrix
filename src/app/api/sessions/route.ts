import { NextRequest, NextResponse } from 'next/server'
import { targetManager } from '@/web/target-manager'
import { hideWebSession, listPersistedWebSessions, persistWebSession, webSessionId } from '@/web/session-registry'

export async function GET() {
  try {
    const liveTargets = await targetManager.listTargets()
    const persistedTargets = await listPersistedWebSessions()
    const byTarget = new Map<string, {
      target: string
      engineId: string
      actualEngineId?: string
      initialized: boolean
      running: boolean
      persisted: boolean
      createdAt?: number
      lastActiveAt?: number
    }>()

    for (const session of persistedTargets) {
      byTarget.set(session.target, {
        target: session.target,
        engineId: session.sessionId,
        initialized: false,
        running: false,
        persisted: true,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
      })
    }

    for (const target of liveTargets) {
      byTarget.set(target.target, {
        ...byTarget.get(target.target),
        target: target.target,
        engineId: webSessionId(target.target),
        actualEngineId: target.engineId,
        initialized: target.initialized,
        running: target.running,
        persisted: true,
      })
    }

    const targets = [...byTarget.values()].sort((a, b) => (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0))
    return NextResponse.json({ targets })
  } catch (err) {
    return NextResponse.json({ targets: [], error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rawTarget = typeof body?.target === 'string' ? body.target.trim() : ''
    if (!rawTarget) {
      return NextResponse.json({ error: 'target is required' }, { status: 400 })
    }

    let target: string
    try {
      const parsed = new URL(/^https?:\/\//i.test(rawTarget) ? rawTarget : `https://${rawTarget}`)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
      parsed.hash = ''
      target = parsed.toString()
    } catch {
      return NextResponse.json({ error: 'Enter a valid HTTP or HTTPS target.' }, { status: 400 })
    }

    // Creating a workspace must not launch browser/OAST infrastructure. The
    // engine initializes lazily when the user starts their first run.
    const session = await persistWebSession(target)
    return NextResponse.json({
      target,
      engineId: session.sessionId,
      initialized: false,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    if (!target) {
      return NextResponse.json({ error: 'target is required' }, { status: 400 })
    }

    await targetManager.destroyEngine(target)
    await hideWebSession(target)
    return NextResponse.json({ ok: true, target })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
