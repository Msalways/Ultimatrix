import { resolve } from 'node:path'
import {existsSync, writeFileSync} from 'node:fs'
import type { Finding } from '../generation/test-generator'

const args = process.argv.slice(2)
const subcommand = args[0]

function printCliHelp(): void {
  process.stdout.write([
    'Ultimatrix - intelligence-augmented security research',
    '',
    'Usage:',
    '  ultimatrix <command> [options]',
    '  ultimatrix -t <url>                 Start an interactive session',
    '',
    'Core commands:',
    '  web                                Open the web workspace',
    '  interact -t <url>                  Interactive research session',
    '  solve -t <url>                     Run an autonomous assessment',
    '  ci -t <url> [--fail-on <severity>] Run assessment and emit versioned JSON',
    '  learn -t <url>                     Capture and model the target',
    '  scan -t <url>                      Learn, test, and report',
    '  resume -t <url>                    Resume persisted target context',
    '',
    'Analysis and operations:',
    '  report -t <url> [--format <type>]  Export findings',
    '  verify -t <url>                    Recheck findings',
    '  replay [-o <dir>]                  Replay generated tests',
    '  models | tools | mcp | budget      Inspect runtime capabilities',
    '  providers list|set|remove          Manage project provider keys',
    '  config doctor                      Check setup health and effective routing',
    '  config path                        Show the canonical config file',
    '  config migrate-credentials         Import the legacy credential store',
    '  init                               Configure providers and defaults',
    '',
    'Global options:',
    '  -t, --target <url>                 Target URL',
    '  -o, --output <dir>                 Output directory',
    '  --approve-origin <url>             Pre-approve a proposed origin (repeatable)',
    '  -h, --help                         Show help',
    '  -v, --version                      Show version',
    '',
  ].join('\n'))
}

// Helper to get target from args or config
function getTarget(cliArgs: string[], loadConfig: typeof import('../config').loadConfig): string {
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

/** Repeatable `--approve-origin <url|origin>` flags → proposed-origin approvals. */
function getApprovedOrigins(cliArgs: string[]): string[] {
  const origins: string[] = []
  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === '--approve-origin') {
      const v = cliArgs[i + 1]
      if (v && !v.startsWith('-')) origins.push(v)
    }
  }
  return origins
}

;(async () => {
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printCliHelp()
    return
  }
  if (subcommand === '--version' || subcommand === '-v') {
    process.stdout.write('Ultimatrix 2.0.0\n')
    return
  }

  const knownCommands = new Set([
    'init', 'learn', 'generate', 'replay', 'report', 'scan', 'solve', 'ci', 'assess',
    'verify', 'interact', 'resume', 'web', 'models', 'budget', 'ratelimit', 'tools', 'mcp', 'config', 'providers',
  ])
  if (subcommand && !subcommand.startsWith('-') && !knownCommands.has(subcommand)) {
    process.stderr.write(`Unknown command: ${subcommand}\n`)
    process.stdout.write('Run `ultimatrix --help` to see available commands.\n')
    process.exitCode = 1
    return
  }

  await import('../patches/ai-sdk')

  const [
    sessionModule, configModule, initModule, assessModule, verifyModule,
    interactModule, webModule, solveModule, modelsModule, budgetModule,
    ratelimitModule, toolsModule, mcpModule, providersModule, loggerModule, observabilityModule,
    sdkModule, authorizationModule, reportModule, effectiveConfigModule,
  ] = await Promise.all([
    import('../session'), import('../config'), import('./init'), import('./assess'), import('./verify'),
    import('./interact'), import('./web'), import('./solve'), import('./models'), import('./budget'),
    import('./ratelimit'), import('./tools'), import('./mcp'), import('./providers'), import('../utils/logger'), import('../observability'),
    import('../sdk'), import('../authorization'), import('../report/generator'), import('../models/effective-config'),
  ])

  const { main } = sessionModule
  const { getConfigPath, getProvidersPath, loadConfig, migrateLegacyCredentialsToProject } = configModule
  const { initWizard } = initModule
  const { assessCommand } = assessModule
  const { verifyCommand } = verifyModule
  const { interactCommand } = interactModule
  const { webCommand } = webModule
  const { solveCommand } = solveModule
  const { modelsCommand } = modelsModule
  const { budgetCommand } = budgetModule
  const { ratelimitCommand } = ratelimitModule
  const { toolsCommand } = toolsModule
  const { mcpCommand } = mcpModule
  const { providersCommand } = providersModule
  const { log, setPinoLogger } = loggerModule
  const { initLogger, initObservability } = observabilityModule
  const { Ultimatrix } = sdkModule
  const { showDisclaimer } = authorizationModule
  const { generateReport } = reportModule
  const { resolveEffectiveConfig } = effectiveConfigModule

  setPinoLogger(initLogger())
  initObservability()

  switch (subcommand) {
    case 'init':
      await initWizard()
      break

    case 'learn': {
      const target = getTarget(args.slice(1), loadConfig)
      const outputDir = getOutputDir(args.slice(1))
      showDisclaimer(target)

      const scanner = new Ultimatrix({ target, outputDir })
      const analysis = await scanner.learn()
      log.info(`Analysis complete: ${analysis.endpoints.length} endpoints, ${analysis.secrets.length} secrets`)
      await scanner.close()
      break
    }

    case 'generate': {
      const target = getTarget(args.slice(1), loadConfig)
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
      const target = getTarget(args.slice(1), loadConfig)
      const outputDir = getOutputDir(args.slice(1))
      const formatIdx = args.indexOf('--format')
      const format = (formatIdx !== -1 ? args[formatIdx + 1] : 'markdown') as 'json' | 'html' | 'markdown'
      log.info(`Generating ${format} report...`)

      // REPORT-1: Load findings from graph store if target specified
      let findings: Finding[] = []
      let runtime: Awaited<ReturnType<typeof import('../runtime/engagement-runtime').createEngagementRuntime>> | undefined
      if (target) {
        try {
          const config = loadConfig()
          config.target = target
          const { createEngagementRuntime } = await import('../runtime/engagement-runtime')
          runtime = await createEngagementRuntime(config, target, { outputDir })
          await runtime.run(async () => {
            const store = runtime!.graph
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
          })
        } catch (err) {
          log.dim('Could not load graph: ' + (err instanceof Error ? err.message : String(err)))
        }
      }

      // Get forensic log data if available
      const forensicLog = runtime?.forensicLog
      const forensicEvents = forensicLog?.getEvents() || []
      const forensicSummary = forensicLog?.getSummary() || ''

      const report = generateReport(findings, [], {
        format,
        includeEvidence: true,
        forensicEvents,
        forensicSummary,
      })

      // REPORT-3: Save to file
      const reportDir = target && runtime
        ? resolve(runtime.workspace.getTargetDir(target), 'reports')
        : outputDir
      if (!existsSync(reportDir)) {
        const { mkdirSync } = await import('node:fs')
        mkdirSync(reportDir, { recursive: true })
      }
      const reportPath = resolve(reportDir, `report-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`)
      writeFileSync(reportPath, report, 'utf-8')
      log.success('Report saved: ' + reportPath)
      if (runtime) {
        await runtime.run(async () => {
          runtime!.artifacts.create('report', {
            path: reportPath,
            initialStatus: 'redacted',
            provenance: [{ source: 'report-generator', ref: 'generateReport' }],
          })
          await runtime!.saveCheckpoint('cli:report')
        })
        await runtime.dispose()
      }
      break
    }

    case 'scan': {
      const target = getTarget(args.slice(1), loadConfig)
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
      await scanner.registerArtifact('report', {
        path: reportPath,
        initialStatus: 'redacted',
        provenance: [{ source: 'report-generator', ref: 'scanner.exportReport' }],
      })
      await scanner.close()
      break
    }

    case 'solve': {
      const target = getTarget(args.slice(1), loadConfig)
      const outputDir = getOutputDir(args.slice(1))
      if (!target) { log.error('solve requires a target: ultimatrix solve -t <url>'); process.exit(1) }
      showDisclaimer(target)
      await solveCommand(target, outputDir, getApprovedOrigins(args.slice(1)))
      break
    }

    case 'ci': {
      const target = getTarget(args.slice(1), loadConfig)
      const outputDir = getOutputDir(args.slice(1))
      if (!target) { process.stderr.write('ci requires a target: ultimatrix ci -t <url>\n'); process.exitCode = 2; break }
      const failOnIndex = args.indexOf('--fail-on')
      const failOn = (failOnIndex >= 0 ? args[failOnIndex + 1] : 'high') as import('../ci/result').CiSeverityThreshold
      if (!['low', 'medium', 'high', 'critical', 'none'].includes(failOn)) {
        process.stderr.write('--fail-on must be low, medium, high, critical, or none\n')
        process.exitCode = 2
        break
      }
      const { buildCiAssessmentResult, ciExitCode } = await import('../ci/result')
      loggerModule.setLogSink(() => {})
      try {
        const solved = await solveCommand(target, outputDir, getApprovedOrigins(args.slice(1)), { quiet: true })
        const result = buildCiAssessmentResult(solved.caseFile, solved.workflowRef, solved.durationMs)
        process.stdout.write(`${JSON.stringify(result)}\n`)
        process.exitCode = ciExitCode(result, failOn)
      } catch (error) {
        const result = {
          schemaVersion: 1,
          workflowRef: '',
          status: 'failed' as const,
          verifiedFindings: [],
          candidates: [],
          executionErrors: [{ message: error instanceof Error ? error.message : String(error) }],
          artifactRefs: [],
          metrics: { durationMs: 0, verifiedFindings: 0, incompleteCandidates: 0 },
        }
        process.stdout.write(`${JSON.stringify(result)}\n`)
        process.exitCode = 2
      } finally {
        loggerModule.setLogSink(null)
      }
      break
    }

    case 'assess': {
      const target = getTarget(args.slice(1), loadConfig)
      if (target) showDisclaimer(target)
      await assessCommand(args.slice(1))
      break
    }

    case 'verify': {
      const target = getTarget(args.slice(1), loadConfig)
      if (target) showDisclaimer(target)
      await verifyCommand(args.slice(1))
      break
    }

    case 'interact': {
      const target = getTarget(args.slice(1), loadConfig)
      if (target) showDisclaimer(target)
      await interactCommand(args.slice(1))
      break
    }

    case 'resume': {
      const target = getTarget(args.slice(1), loadConfig)
      if (target) showDisclaimer(target)
      else { log.error('Resume requires a target: ultimatrix resume -t <url>'); process.exit(1) }
      await main(target)
      break
    }

    case 'web':
      await webCommand()
      break

    case 'models': {
      const modelArgs = args.slice(1)
      await modelsCommand(modelArgs)
      break
    }

    case 'budget': {
      const budgetArgs = args.slice(1)
      await budgetCommand(budgetArgs)
      break
    }

    case 'ratelimit': {
      const rlArgs = args.slice(1)
      await ratelimitCommand(rlArgs)
      break
    }

    case 'tools': {
      const toolArgs = args.slice(1)
      await toolsCommand(toolArgs)
      break
    }

    case 'mcp': {
      const mcpArgs = args.slice(1)
      await mcpCommand(mcpArgs)
      break
    }

    case 'providers': {
      await providersCommand(args.slice(1))
      break
    }

    case 'skills': {
      // Phase D — first-class skill management: list / add <path> / remove <id>.
      const { manageSkills } = await import('../tools/skill-manage-tools')
      const sub = args[1] || 'list'
      const exec = (input: unknown) => (manageSkills as any).execute(input)
      if (sub === 'list') {
        const res = await exec({ action: 'list' })
        for (const s of res.skills ?? []) {
          process.stdout.write(`${s.source === 'imported' ? '[imported]' : '[bundled] '} ${s.id} — ${s.name}\n`)
        }
        process.stdout.write(`${(res.skills ?? []).length} skill(s)\n`)
      } else if (sub === 'add') {
        const target = args[2]
        if (!target) { log.error('usage: ultimatrix skills add <path-to-SKILL.md | skill-dir>'); process.exit(1) }
        const res = await exec({ action: 'add', path: target })
        if (res.ok) log.success(res.message ?? 'imported')
        else { for (const e of res.errors ?? ['import failed']) log.error(e); process.exit(1) }
      } else if (sub === 'remove') {
        const id = args[2]
        if (!id) { log.error('usage: ultimatrix skills remove <id>'); process.exit(1) }
        const res = await exec({ action: 'remove', id })
        if (res.ok) log.success(res.message ?? 'removed')
        else { for (const e of res.errors ?? ['remove failed']) log.error(e); process.exit(1) }
      } else {
        log.error('usage: ultimatrix skills [list|add|remove]')
        process.exit(1)
      }
      break
    }

    case 'config': {
      const action = args[1] || 'path'
      if (action === 'path') {
        process.stdout.write(`Config: ${getConfigPath()}\nProviders: ${getProvidersPath()}\n`)
      } else if (action === 'doctor') {
        const config = loadConfig({ requireCredentials: false })
        const effective = resolveEffectiveConfig(config)
        log.info(`Config health: ${effective.status}`)
        for (const error of effective.errors) log.error(`  ${error}`)
        for (const warning of effective.warnings) log.warn(`  ${warning}`)
        log.info('\nEffective routing:')
        for (const role of ['brain', 'spider', 'crawlSummarizer', 'verifier', 'reporter', 'council'] as const) {
          const route = effective.modules[role]
          const cap = route.capability
          log.info(`  ${role.padEnd(15)} ${route.tier.padEnd(8)} ${route.modelId} ${cap ? `${cap.contextWindow.toLocaleString()} ctx / ${cap.maxOutputTokens.toLocaleString()} out` : 'unknown limits'}`)
        }
        log.info('\nWorkers: low->fast, medium->balanced, high/critical->powerful')
        if (effective.mcp.length > 0) {
          log.info('\nConnectors:')
          for (const server of effective.mcp) {
            log.info(`  ${server.name} ${server.type} ${server.trusted ? 'trusted' : 'untrusted'} ${server.location}`)
          }
        }
      } else if (action === 'migrate-credentials') {
        const result = migrateLegacyCredentialsToProject()
        log.success(`Credential source: ${result.providersPath}`)
        log.info(`Migrated: ${result.migrated.join(', ') || 'none'}`)
        if (result.skipped.length > 0) log.dim(`Already configured: ${result.skipped.join(', ')}`)
      } else {
        log.error(`Unknown config action: ${action}`)
        log.dim('Use `ultimatrix config doctor`, `ultimatrix config path`, or `ultimatrix config migrate-credentials`.')
        process.exitCode = 1
      }
      break
    }

    default: {
      if (subcommand && !subcommand.startsWith('-')) {
        log.error(`Unknown command: ${subcommand}`)
        process.stdout.write('Run `ultimatrix --help` to see available commands.\n')
        process.exitCode = 1
        break
      }
      const target = getTarget(args, loadConfig)
      if (target) {
        showDisclaimer(target)
      }
      await main(target)
      break
    }
  }
})().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
