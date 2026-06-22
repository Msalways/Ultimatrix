import { log } from '../utils/logger'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

export async function webCommand(): Promise<void> {
  const dev = process.env.NODE_ENV !== 'production'

  // next() must be imported dynamically to avoid bundling Next.js into the CLI
  const { default: next } = await import('next')

  const app = next({ dev, hostname: HOST, port: PORT, dir: resolve('.') })
  const handle = app.getRequestHandler()

  await app.prepare()

  const server = createServer((req, res) => {
    handle(req, res)
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, HOST, () => {
      const host = HOST === '0.0.0.0' ? 'localhost' : HOST
      log.banner('Ultimatrix Web UI', `http://${host}:${PORT}`)
      if (dev) {
        log.info('Press Ctrl+C to stop the server')
      }
      resolve()
    })
    server.on('error', (err: Error) => {
      log.error('Failed to start web server: ' + err.message)
      reject(err)
    })
  })
}
