import { getWebConfig } from '@/web/config-bridge'
import { resolveEffectiveConfig } from '@/models/effective-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const config = await getWebConfig()
    return Response.json({ ok: true, effective: resolveEffectiveConfig(config) }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

