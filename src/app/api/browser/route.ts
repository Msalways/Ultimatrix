import { NextResponse } from 'next/server'
import { targetManager } from '@/web/target-manager'

function targetFrom(request: Request): string | null {
  return new URL(request.url).searchParams.get('target')
}

export async function GET(request: Request) {
  try {
    const target = targetFrom(request)
    if (!target) return NextResponse.json({ ok: false, error: 'target is required' }, { status: 400 })
    const engine = targetManager.getEngine(target)
    if (!engine?.isInitialized()) return NextResponse.json({ ok: false, error: 'target engine is not active' }, { status: 404 })
    return NextResponse.json({ ok: true, target, browser: await engine.startBrowser() })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const target = targetFrom(request)
    if (!target) return NextResponse.json({ ok: false, error: 'target is required' }, { status: 400 })
    const engine = targetManager.getEngine(target)
    if (!engine?.isInitialized()) return NextResponse.json({ ok: false, error: 'target engine is not active' }, { status: 404 })
    if (engine.isRunning()) {
      return NextResponse.json({
        ok: false,
        error: 'Cannot close the automation browser while a solve is running.',
        running: [target],
      }, { status: 409 })
    }

    await targetManager.destroyEngine(target)
    return NextResponse.json({ ok: true, target, browser: { active: false } })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
