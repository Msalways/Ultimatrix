import { main } from '../session'
import { log } from '../utils/logger'
import { loadConfig } from '../config'

export async function verifyCommand(args: string[]): Promise<void> {
  const targetIdx = args.indexOf('-t')
  const targetFlagIdx = args.indexOf('--target')
  const modelIdx = args.indexOf('-a')
  const modelFlagIdx = args.indexOf('--app-model')

  const target = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : undefined
  const appModel = modelIdx !== -1 ? args[modelIdx + 1] : modelFlagIdx !== -1 ? args[modelFlagIdx + 1] : undefined

  if (!target || !appModel) {
    log.error('Usage: ultimatrix verify -a <app-model.json> -t <new-url>')
    process.exit(1)
  }

  process.env.APP_MODEL_PATH = appModel

  log.banner('Ultimatrix v5 — Verify Mode', `Target: ${target}, Model: ${appModel}`)
  log.info('Re-running previous findings against fresh deployment')

  await main(target)
}
