import { main } from '../session'
import { log } from '../utils/logger'
import { loadConfig } from '../config'
import { resolve } from 'node:path'

export async function assessCommand(args: string[]): Promise<void> {
  const targetIdx = args.indexOf('-t')
  const targetFlagIdx = args.indexOf('--target')
  const outputIdx = args.indexOf('-o')
  const outputFlagIdx = args.indexOf('--output')

  const target = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : undefined
  const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : outputFlagIdx !== -1 ? args[outputFlagIdx + 1] : undefined

  if (!target) {
    log.error('Usage: ultimatrix assess -t <url> [-o <output-dir>]')
    process.exit(1)
  }

  if (outputDir) {
    process.env.OUTPUT_DIR = resolve(outputDir)
  }

  log.banner('Ultimatrix v6 — Assess Mode', `Target: ${target}`)
  log.info('Running full assessment: spider → extract → build model → dynamic skill search → test')
  log.info('Skills are loaded dynamically from ./skills directory')

  await main(target)
}
