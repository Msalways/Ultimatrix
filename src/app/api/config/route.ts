import { NextRequest } from 'next/server'
import { getWebConfig, saveWebConfig, maskCredentials } from '@/web/config-bridge'
import { targetManager } from '@/web/target-manager'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  try {
    const config = await getWebConfig()
    return Response.json(maskCredentials(config), { headers: NO_STORE_HEADERS })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await saveWebConfig(body)
    if (!result.ok) {
      return Response.json({ ok: false, errors: result.errors }, { status: 400 })
    }
    const engines = await targetManager.resetIdleEngines()
    return Response.json({ ok: true, engines })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
