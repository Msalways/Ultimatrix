import { NextRequest, NextResponse } from 'next/server'
import { runSetup, testProviderConnection } from '@/core/setup-service'
import { resetConfigCache } from '@/config'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { provider, model, apiKey, baseUrl, engine, modelTiers, crossProviderKeys } = body

    if (!provider || !model || !apiKey) {
      return NextResponse.json(
        { ok: false, errors: ['provider, model, and apiKey are required'] },
        { status: 400 },
      )
    }

    const result = await runSetup({
      provider,
      model,
      apiKey,
      baseUrl,
      engine,
      modelTiers,
      crossProviderKeys,
    })

    if (result.ok) {
      resetConfigCache()
    }

    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, errors: [(err as Error).message] },
      { status: 500 },
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { baseUrl, model, apiKey } = body

    if (!baseUrl || !model || !apiKey) {
      return NextResponse.json(
        { ok: false, error: 'baseUrl, model, and apiKey are required' },
        { status: 400 },
      )
    }

    const result = await testProviderConnection(baseUrl, model, apiKey)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    )
  }
}
