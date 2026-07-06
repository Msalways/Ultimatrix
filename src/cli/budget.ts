import { loadConfig } from '../config'
import { log } from '../utils/logger'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ForensicLog } from '../logging/forensic-log'
import { BudgetDashboard } from '../tools/budget-dashboard'

export async function budgetCommand(args: string[]): Promise<void> {
  const sub = args[0] || 'status'
  const config = loadConfig()
  const budgetPolicy = config.budgetPolicy || {
    enforcement: 'soft' as const,
    scope: 'session' as const,
    resetOn: 'never' as const,
    allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
    maxModelCallsPerTask: 15,
    trackTokens: false,
  }

  switch (sub) {
    case 'status': {
      const logPath = args[1] || join(mkdtempSync(join(tmpdir(), 'budget-')), 'forensic.ndjson')
      const fl = new ForensicLog(logPath)
      const dash = new BudgetDashboard(fl, budgetPolicy)
      dash.printLiveDashboard()
      break
    }

    case 'history': {
      const logPath = args[1]
      if (!logPath) {
        log.error('Usage: ultimatrix budget history <forensic-log-path>')
        log.dim('Find the log path in your output/ directory')
        process.exit(1)
      }

      const fl = new ForensicLog(logPath)
      const dash = new BudgetDashboard(fl, budgetPolicy)
      const summary = dash.getSessionSummary()

      log.info('\nSession Budget History:\n')
      log.info(`  Total model calls: ${summary.totalModelCalls}`)
      log.info(`  Input tokens: ${summary.totalTokens.input}`)
      log.info(`  Output tokens: ${summary.totalTokens.output}`)
      log.info(`  Total tokens: ${summary.totalTokens.total}`)

      const providers = Object.entries(summary.byProvider)
      if (providers.length > 0) {
        log.info('\n  By provider:')
        for (const [name, data] of providers) {
          log.info(`    ${name}: ${data.calls} calls, ${data.inputTokens + data.outputTokens} tokens`)
        }
      }

      const roles = Object.entries(summary.byAgentRole)
      if (roles.length > 0) {
        log.info('\n  By agent role:')
        for (const [name, data] of roles) {
          log.info(`    ${name}: ${data.calls} calls, ${data.tokens} tokens`)
        }
      }

      if (summary.warnings.length > 0) {
        log.info('\n  Warnings:')
        for (const w of summary.warnings) {
          log.warn(`    ${w}`)
        }
      }
      break
    }

    default:
      log.info('Usage: ultimatrix budget <status|history> [path]')
  }
}
