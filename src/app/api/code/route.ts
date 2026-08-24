import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const target = req.nextUrl.searchParams.get('target')
    if (!target) {
      return Response.json({ error: 'target is required' }, { status: 400 })
    }

    const { targetManager } = await import('@/web/target-manager')
    const engine = targetManager.getEngine(target)
    if (!engine?.isInitialized()) {
      return Response.json({ code: [] })
    }

    const code = engine.getCode()
    return Response.json({ code })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
