import { main } from '../session'
import { loadConfig } from '../config'
import { initWizard } from './init'
import { assessCommand } from './assess'
import { scanCommand } from './scan'
import { verifyCommand } from './verify'
import { interactCommand } from './interact'
import { webCommand } from './web'
import { log } from '../utils/logger'
import { getBrowser } from '../browser/manager'
import { startOastServer, stopOastServer } from '../oast/server'
import { getGlobalOastStore } from '../oast/store'
import { createRecorder, getGlobalRecorder } from '../recorder/index'
import { getGlobalGraphStore } from '../graph/store'
import { createAllWorkers } from '../workers/registry'
import { setSharedWorkers } from '../tools/delegate-tool'
import { createSupervisor } from '../manager/agent'
import { checkForPreviousSession, resumeSession } from '../intelligence/session-resume'

const args = process.argv.slice(2)
const subcommand = args[0]

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
    if (args.includes('--cli')) {
      const targetIdx = args.indexOf('-t')
      const targetFlagIdx = args.indexOf('--target')
      const cliTarget = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : args[0]
      const config = loadConfig()
      const target = cliTarget || config.target

      if (target) {
        log.info('Target: ' + target)
      }

      main(target).catch((err) => {
        log.error('Fatal: ' + (err instanceof Error ? err.message : String(err)))
        process.exit(1)
      })
      break
    }

    const targetIdx = args.indexOf('-t')
    const targetFlagIdx = args.indexOf('--target')
    const cliTarget = targetIdx !== -1 ? args[targetIdx + 1] : targetFlagIdx !== -1 ? args[targetFlagIdx + 1] : args[0]
    const config = loadConfig()
    const target = cliTarget || config.target
    const modelName = config.modelId

    const tryStartTui = async () => {
      const threadId = 'ultimatrix-' + Date.now()

      const sessionSummary = await checkForPreviousSession()
      if (sessionSummary.hasPreviousSession) {
        log.info(`Previous session found: ${sessionSummary.findingCount} findings, ${sessionSummary.pageCount} pages, ${sessionSummary.actionCount} actions`)
        await resumeSession(sessionSummary.lastSessionName)
      }

      if (target && !getGlobalRecorder()) createRecorder(target)

      const oastPort = await startOastServer()
      log.info(`OAST server started on port ${oastPort}`)
      await getGlobalOastStore().load()
      await getGlobalGraphStore().load()

      const browser = getBrowser()
      const recorder = getGlobalRecorder() || undefined

      const workers = await createAllWorkers(config.model as any, browser, recorder)
      setSharedWorkers(workers)

      const supervisor = createSupervisor(config)

      const { startTUI } = await import('../tui/index')
      startTUI(target, modelName, async (text: string, onToken?: (token: string) => void) => {
        const stream = await supervisor.stream(text, { memory: { thread: threadId, resource: 'ultimatrix' } })
        let fullText = ''
        for await (const chunk of stream.textStream) {
          fullText += chunk
          onToken?.(chunk)
        }
        await getGlobalGraphStore().save()
        await getGlobalOastStore().save()
        return fullText || '(no response)'
      })
    }

    tryStartTui().catch((err) => {
      log.error('TUI: ' + (err instanceof Error ? err.message : String(err)))
      process.exit(1)
    })
    break
  }
}
