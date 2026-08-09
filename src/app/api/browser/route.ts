import { NextResponse } from 'next/server'
import { closeBrowser, getBrowserState } from '@/browser/manager'
import { targetManager } from '@/web/target-manager'

export async function GET() {
  try {
    return NextResponse.json({ ok: true, browser: getBrowserState() })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const reset = await targetManager.resetIdleEngines()
    if (reset.running.length > 0) {
      return NextResponse.json({
        ok: false,
        error: 'Cannot close the automation browser while a solve is running.',
        running: reset.running,
      }, { status: 409 })
    }

    await closeBrowser()
    return NextResponse.json({ ok: true, browser: getBrowserState(), reset: reset.reset })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
