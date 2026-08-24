import { NextRequest, NextResponse } from 'next/server'
import { targetManager } from '@/web/target-manager'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target')
  if (!target) return NextResponse.json({ error: 'target is required' }, { status: 400 })
  const engine = targetManager.getEngine(target)
  if (!engine?.isInitialized()) return NextResponse.json({ workers: [], recent: [], count: 0 })
  return NextResponse.json(engine.getWorkerEventSnapshot())
}
