import { NextRequest, NextResponse } from 'next/server'
import { targetManager } from '@/web/target-manager'

export async function GET() {
  try {
    const targets = await targetManager.listTargets()
    return NextResponse.json({ targets })
  } catch (err) {
    return NextResponse.json({ targets: [], error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { target } = await req.json()
    if (!target) {
      return NextResponse.json({ error: 'target is required' }, { status: 400 })
    }

    const engine = await targetManager.getOrCreateEngine(target)
    return NextResponse.json({
      target: engine.target,
      engineId: engine.id,
      initialized: engine.isInitialized(),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
