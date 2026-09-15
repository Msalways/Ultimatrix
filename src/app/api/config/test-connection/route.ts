import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { provider, model, apiKey, baseUrl, endpoint, deployment, apiVersion, authMethod, accessKeyId, secretAccessKey, sessionToken, region } = body

    if (!provider || !model || !apiKey) {
      return Response.json({ ok: false, error: 'Missing required fields' }, { status: 400 })
    }

    let url = ''
    let headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let payload: Record<string, unknown> = {}

    if (provider === 'azure') {
      if (!endpoint || !deployment) {
        return Response.json({ ok: false, error: 'Azure requires endpoint and deployment' }, { status: 400 })
      }
      url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion || '2024-10-21'}`
      headers['api-key'] = apiKey
      payload = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }
    } else if (provider === 'bedrock') {
      return Response.json({ ok: true, message: 'Bedrock credentials saved (connection test requires AWS SDK — skipped)' })
    } else {
      url = `${(baseUrl || '').replace(/\/$/, '')}/chat/completions`
      headers['Authorization'] = `Bearer ${apiKey}`
      payload = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        let msg = `HTTP ${res.status}`
        try {
          const parsed = JSON.parse(errText)
          msg = parsed.error?.message || parsed.message || msg
        } catch {
          if (errText) msg = errText.slice(0, 200)
        }
        return Response.json({ ok: false, error: msg })
      }

      return Response.json({ ok: true, message: `Connected — model ${model} responded` })
    } catch (fetchErr: unknown) {
      clearTimeout(timeout)
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        return Response.json({ ok: false, error: 'Connection timed out (30s)' })
      }
      throw fetchErr
    }
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
