import { NextRequest } from 'next/server'
import { getWebConfig } from '@/web/config-bridge'
import { validateConfig, ConfigError } from '@/config'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const current = await getWebConfig()
    const merged = { ...current, ...body }
    validateConfig(merged as Record<string, unknown>)
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof ConfigError) {
      return Response.json({ ok: false, errors: [err.message] }, { status: 400 })
    }
    return Response.json({ ok: false, errors: [String(err)] }, { status: 500 })
  }
}
