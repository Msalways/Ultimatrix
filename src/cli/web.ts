import { log } from '../utils/logger'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Ultimatrix Dashboard</title><style>body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:2rem;background:#0d1117;color:#c9d1d9}a{color:#58a6ff}h1{border-bottom:1px solid #30363d;padding-bottom:0.5rem}.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:1rem;margin:1rem 0}.stat{font-size:2rem;font-weight:700;color:#58a6ff}</style></head><body><h1>Ultimatrix Dashboard</h1><div class="card"><h2>Status</h2><p>Server is running on port ${PORT}</p></div><div class="card"><h2>Quick Links</h2><ul><li><a href="/api/status">API Status</a></li></ul></div></body></html>`

export async function webCommand(): Promise<void> {
  const server = createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, service: 'ultimatrix', port: PORT, uptime: process.uptime() }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(HTML)
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, HOST, () => {
      log.info(`Web UI at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
      resolve()
    })
    server.on('error', reject)
  })
}
