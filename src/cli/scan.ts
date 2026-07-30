import { main } from '../session'
import { log } from '../utils/logger'

export async function scanCommand(args: string[]): Promise<void> {
  const targetIdx = args.indexOf('-t')
  const targetFlagIdx = args.indexOf('--target')

  const target = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : undefined

  if (!target) {
    log.error('Usage: ultimatrix scan -t <url> [-o <dir>]')
    process.exit(1)
  }

  log.banner('Ultimatrix v6 — Scan Mode', `Target: ${target}`)
  log.info('Running autonomous pentest with dynamic skill discovery (reusing existing app model if available)')

  await main(target)
}
