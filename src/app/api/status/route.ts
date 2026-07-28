import { NextRequest } from 'next/server'
import { targetManager } from '@/web/target-manager'

export async function GET(_req: NextRequest) {
  try {
    const engine = targetManager.getEngine('') || null
    const targets = await targetManager.listTargets()
    const activeTarget = targets.length > 0 ? targets[targets.length - 1] : null

    return Response.json({
      ok: true,
      targets: targets.map(t => t.target),
      activeTarget: activeTarget?.target ?? null,
      initialized: activeTarget?.initialized ?? false,
      running: activeTarget?.running ?? false,
      uptime: process.uptime(),
      deployed: process.env.DEPLOYED === 'true',
      targetCount: targets.length,
    })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
