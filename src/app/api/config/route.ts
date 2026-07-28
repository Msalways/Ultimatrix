import { NextRequest } from 'next/server'
import { getWebConfig, saveWebConfig, maskCredentials } from '@/web/config-bridge'

export async function GET() {
  try {
    const config = await getWebConfig()
    return Response.json(maskCredentials(config))
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await saveWebConfig(body)
    if (!result.ok) {
      return Response.json({ ok: false, errors: result.errors }, { status: 400 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
