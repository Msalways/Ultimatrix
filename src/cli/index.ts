import '../patches/ai-sdk'
import { main } from '../session'
import { loadConfig } from '../config'
import { initWizard } from './init'
import { assessCommand } from './assess'
import { verifyCommand } from './verify'
import { interactCommand } from './interact'
import { webCommand } from './web'
import { solveCommand } from './solve'
import { log, setPinoLogger } from '../utils/logger'
import { initLogger, initObservability } from '../observability'
import { Ultimatrix } from '../sdk'
import { resolve } from 'node:path'
import { showDisclaimer } from '../authorization'
import { getGlobalWorkspace } from '../workspace'
import { GraphStore } from '../graph/store'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { getForensicLog } from '../tools/report-tools'
import { generateReport } from '../report/generator'
import type { Finding } from '../generation/test-generator'

const args = process.argv.slice(2)
const subcommand = args[0]

// Initialize structured logging + observability for all subcommands
const pino = initLogger()
setPinoLogger(pino)
initObservability()

// Helper to get target from args or config
function getTarget(cliArgs: string[]): string {
  const targetIdx = cliArgs.indexOf('-t')
  const targetFlagIdx = cliArgs.indexOf('--target')
  const target = targetIdx !== -1 ? cliArgs[targetIdx + 1] : targetFlagIdx !== -1 ? cliArgs[targetFlagIdx + 1] : undefined
  if (target) return target
  try {
    const config = loadConfig()
    return config.target || ''
  } catch {
    return ''
  }
}

function getOutputDir(cliArgs: string[]): string {
  const outIdx = cliArgs.indexOf('-o')
  const outFlagIdx = cliArgs.indexOf('--output')
  return (outIdx !== -1 ? cliArgs[outIdx + 1] : outFlagIdx !== -1 ? cliArgs[outFlagIdx + 1] : undefined) || resolve(process.cwd(), 'output')
}

;(async () => {
  switch (subcommand) {
    case 'init':
      await initWizard()
      break

    case 'learn': {
      const target = getTarget(args.slice(1))
      const outputDir = getOutputDir(args.slice(1))
      showDisclaimer(target)

      const scanner = new Ultimatrix({ target, outputDir })
      const analysis = await scanner.learn()
      log.info(`Analysis complete: ${analysis.endpoints.length} endpoints, ${analysis.secrets.length} secrets`)
      await scanner.close()
      break
    }

    case 'generate': {
      const target = getTarget(args.slice(1))
      const outputDir = getOutputDir(args.slice(1))
      showDisclaimer(target)

      const scanner = new Ultimatrix({ target, outputDir })
      await scanner.learn()
      const tests = await scanner.generate()
      log.info(`Generated ${tests.length} test cases`)
      await scanner.close()
      break
    }

    case 'replay': {
      const outputDir = getOutputDir(args.slice(1))
      log.info('Replaying generated tests...')

      const scanner = new Ultimatrix({ target: 'http://localhost', outputDir })
      const results = await scanner.replay()
      log.info(`Replay: ${results.passed}/${results.total} passed`)
      await scanner.close()
      break
    }

    case 'report': {
      const target = getTarget(args.slice(1))
      const outputDir = getOutputDir(args.slice(1))
      const formatIdx = args.indexOf('--format')
      const format = (formatIdx !== -1 ? args[formatIdx + 1] : 'markdown') as 'json' | 'html' | 'markdown'
      log.info(`Generating ${format} report...`)

      // REPORT-1: Load findings from graph store if target specified
      let findings: Finding[] = []
      if (target) {
        try {
          const workspace = getGlobalWorkspace()
          await workspace.switchTarget(target)
          const store = workspace.getGraphStore()
          if (store) {
            const allNodes = store.queryNodes()
            const findingNodes = allNodes.filter(n => n.type === 'Finding')
            findings = findingNodes.map(n => {
              const p = n.properties as Record<string, any>
              return {
                id: n.id,
                title: `${p.technique} on ${p.endpoint}`,
                severity: p.severity,
                category: p.technique,
                description: p.evidence?.join('; ') || '',
                evidence: [],
                request: { method: 'GET', url: p.endpoint },
                firstSeen: new Date(n.createdAt),
                lastSeen: new Date(n.updatedAt),
                status: 'open' as const,
              }
            })
          }
        } catch (err) {
          log.dim('Could not load graph: ' + (err instanceof Error ? err.message : String(err)))
        }
      }

      // Get forensic log data if available
      const forensicLog = getForensicLog()
      const forensicEvents = forensicLog?.getEvents() || []
      const forensicSummary = forensicLog?.getSummary() || ''

      const report = generateReport(findings, [], {
        format,
        includeEvidence: true,
        forensicEvents,
        forensicSummary,
      })

      // REPORT-3: Save to file
      const reportDir = target
        ? resolve(getGlobalWorkspace().getTargetDir(target), 'reports')
        : outputDir
      if (!existsSync(reportDir)) {
        const { mkdirSync } = await import('node:fs')
        mkdirSync(reportDir, { recursive: true })
      }
      const reportPath = resolve(reportDir, `report-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`)
      writeFileSync(reportPath, report, 'utf-8')
      log.success('Report saved: ' + reportPath)
      break
    }

    case 'scan': {
      const target = getTarget(args.slice(1))
      const outputDir = getOutputDir(args.slice(1))
      showDisclaimer(target)

      const scanner = new Ultimatrix({ target, outputDir })
      const result = await scanner.scan()
      log.info(`Scan complete: ${result.findings.length} findings, ${result.tests.length} tests generated`)

      // REPORT-3: Save scan report to file
      const scanReportDir = resolve(outputDir, 'reports')
      const { mkdirSync } = await import('node:fs')
      if (!existsSync(scanReportDir)) mkdirSync(scanReportDir, { recursive: true })
      const report = scanner.exportReport('markdown')
      const reportPath = resolve(scanReportDir, `scan-${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
      writeFileSync(reportPath, report, 'utf-8')
      log.success('Report saved: ' + reportPath)
      await scanner.close()
      break
    }

    case 'solve': {
      const target = getTarget(args.slice(1))
      const outputDir = getOutputDir(args.slice(1))
      if (!target) { log.error('solve requires a target: ultimatrix solve -t <url>'); process.exit(1) }
      showDisclaimer(target)
      await solveCommand(target, outputDir)
      break
    }

    case 'assess': {
      const target = getTarget(args.slice(1))
      if (target) showDisclaimer(target)
      await assessCommand(args.slice(1))
      break
    }

    case 'verify': {
      const target = getTarget(args.slice(1))
      if (target) showDisclaimer(target)
      await verifyCommand(args.slice(1))
      break
    }

    case 'interact': {
      const target = getTarget(args.slice(1))
      if (target) showDisclaimer(target)
      await interactCommand(args.slice(1))
      break
    }

    case 'resume': {
      const target = getTarget(args.slice(1))
      if (target) showDisclaimer(target)
      else { log.error('Resume requires a target: ultimatrix resume -t <url>'); process.exit(1) }
      await main(target)
      break
    }

    case 'web':
      await webCommand()
      break

    default: {
      const target = getTarget(args)
      if (target) {
        showDisclaimer(target)
      }
      await main(target)
      break
    }
  }
})().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
