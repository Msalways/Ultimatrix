import { log } from '../utils/logger'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { generateAuthToken, initAuth, maskToken } from '../web/auth'

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '127.0.0.1'

export async function webCommand(): Promise<void> {
  const dev = process.env.NODE_ENV !== 'production'

  // Determine if auth is needed (non-loopback binding)
  const isLoopback = HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost'
  const authToken = isLoopback ? null : generateAuthToken()

  // Initialize auth module
  initAuth(authToken, !isLoopback)

  // Pass auth token to Next.js middleware via env var
  if (authToken) {
    process.env.ULTIMATRIX_AUTH_TOKEN = authToken
    process.env.ULTIMATRIX_AUTH_REQUIRED = '1'
  }

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
      const displayHost = isLoopback ? 'localhost' : HOST
      log.banner('Ultimatrix Web UI', `http://${displayHost}:${PORT}`)

      if (!isLoopback) {
        log.warn('WARNING: Web UI is accessible from other devices on the network.')
        log.warn(`Auth token: ${maskToken(authToken!)}`)
        log.warn('All API requests require this token. Pass it via:')
        log.warn('  Authorization: Bearer <token>  OR  ?token=<token>')
        log.warn('To bind to localhost only, omit --host or set HOST=127.0.0.1')
      } else {
        log.info('Bound to localhost — no auth required for local access.')
      }

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
