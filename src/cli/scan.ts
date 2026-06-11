import { main } from '../session'
import { log } from '../utils/logger'
import { loadConfig } from '../config'

export async function scanCommand(args: string[]): Promise<void> {
  const targetIdx = args.indexOf('-t')
  const targetFlagIdx = args.indexOf('--target')
  const outputIdx = args.indexOf('-o')
  const outputFlagIdx = args.indexOf('--output')

  const target = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : undefined

  if (!target) {
    log.error('Usage: ultimatrix scan -t <url> [-o <dir>]')
    process.exit(1)
  }

  log.banner('Ultimatrix v5 — Scan Mode', `Target: ${target}`)
  log.info('Running autonomous pentest (reusing existing app model if available)')

  await main(target)
}
