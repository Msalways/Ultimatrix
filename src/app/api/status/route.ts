import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'
import { getBrowserState } from '@/browser/manager'
import { listPersistedWebSessions } from '@/web/session-registry'

export async function GET(_req: NextRequest) {
  try {
    const [liveTargets, persistedSessions] = await Promise.all([
      targetManager.listTargets(),
      listPersistedWebSessions(),
    ])
    const liveByTarget = new Map(liveTargets.map((entry) => [entry.target, entry]))
    const targets = [...new Set([
      ...persistedSessions.map((session) => session.target),
      ...liveTargets.map((entry) => entry.target),
    ])]
    const activeTarget = targets.length > 0 ? targets[targets.length - 1] : null
    const activeEngine = activeTarget ? liveByTarget.get(activeTarget) : undefined

    return Response.json({
      ok: true,
      targets,
      activeTarget,
      initialized: activeEngine?.initialized ?? false,
      running: activeEngine?.running ?? false,
      uptime: process.uptime(),
      deployed: process.env.DEPLOYED === 'true',
      targetCount: targets.length,
      browser: getBrowserState(),
    })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
