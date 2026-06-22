import { NextRequest } from 'next/server'

function maskCreds(creds: any): any {
  if (!creds || typeof creds !== 'object') return creds
  const masked = Array.isArray(creds) ? [...creds] : { ...creds }
  for (const key of Object.keys(masked)) {
    const val = masked[key]
    if (key === 'apiKey' || key === 'secretAccessKey' || key === 'sessionToken' || key === 'accessKeyId') {
      masked[key] = val ? val.slice(0, 4) + '****' + val.slice(-4) : undefined
    } else if (typeof val === 'object' && val !== null) {
      masked[key] = maskCreds(val)
    }
  }
  return masked
}

export async function GET() {
  try {
    const { loadConfig } = await import('@/config')
    const config = loadConfig()
    return Response.json({ ...config, creds: maskCreds(config.creds) })
  } catch (err) {
    return Response.json({ ok: false, code: 'LOAD_CONFIG_FAILED', error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { AgentManager } = await import('@/lib/agent-manager')
    const { saveProvidersConfig, saveProjectConfig, validateConfig } = await import('@/config')
    const manager = AgentManager.getInstance()

    if (body.creds) {
      try {
        saveProvidersConfig(body.creds)
      } catch (e) {
        return Response.json({ ok: false, code: 'YAML_WRITE_FAILED', error: String(e) }, { status: 500 })
      }
    }

    try {
      // Merge incoming body with existing config to get full picture
      const existing = manager.isInitialized() ? manager.getConfig() : null
      const merged = { ...(existing as any ?? {}), ...body }
      const validated = validateConfig(merged)
      saveProjectConfig(validated)
    } catch (e) {
      return Response.json({ ok: false, code: 'YAML_WRITE_FAILED', error: String(e) }, { status: 500 })
    }

    try {
      await manager.updateConfig(body)
    } catch (e) {
      return Response.json({ ok: false, code: 'UPDATE_CONFIG_FAILED', error: String(e), initErrors: manager.getInitErrors() }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, code: 'UNKNOWN', error: String(err) }, { status: 500 })
  }
}
