import { main } from '../session'
import { loadConfig } from '../config'
import { initWizard } from './init'
import { assessCommand } from './assess'
import { scanCommand } from './scan'
import { verifyCommand } from './verify'
import { interactCommand } from './interact'
import { webCommand } from './web'
import { log, setPinoLogger } from '../utils/logger'
import { initLogger, initObservability } from '../observability'

const args = process.argv.slice(2)
const subcommand = args[0]

// Initialize structured logging + observability for all subcommands
const pino = initLogger()
setPinoLogger(pino)
initObservability()

switch (subcommand) {
  case 'init':
    initWizard().catch((err) => {
      log.error('Init: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break

  case 'assess':
    assessCommand(args.slice(1)).catch((err) => {
      log.error('Assess: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break

  case 'scan':
    scanCommand(args.slice(1)).catch((err) => {
      log.error('Scan: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break

  case 'verify':
    verifyCommand(args.slice(1)).catch((err) => {
      log.error('Verify: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break

  case 'interact':
    interactCommand(args.slice(1)).catch((err) => {
      log.error('Interact: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break

  case 'web':
    webCommand().catch((err) => {
      log.error('Web: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break

  default: {
    const targetIdx = args.indexOf('-t')
    const targetFlagIdx = args.indexOf('--target')
    const config = loadConfig()
    const target = (targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : undefined) || config.target

    if (target) {
      log.info('Target: ' + target)
    }

    main(target).catch((err) => {
      log.error('Fatal: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break
  }
}
