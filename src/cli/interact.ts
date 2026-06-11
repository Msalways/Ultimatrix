import { main } from '../session'
import { log } from '../utils/logger'

export async function interactCommand(args: string[]): Promise<void> {
  const targetIdx = args.indexOf('-t')
  const targetFlagIdx = args.indexOf('--target')
  const target = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : undefined

  log.banner('Ultimatrix v5 — Interactive REPL', target ? `Target: ${target}` : 'No target')

  await main(target)
}
