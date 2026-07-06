import { log } from '../utils/logger'
import { TokenProfiler } from '../tools/token-profiler'

export async function toolsCommand(args: string[]): Promise<void> {
  const sub = args[0] || 'profile'

  switch (sub) {
    case 'profile': {
      const toolId = args[1] === '--tool' ? args[2] : undefined
      const profiler = new TokenProfiler()

      if (toolId) {
        const profile = profiler.getProfile(toolId)
        if (!profile) {
          log.info(`No profile found for tool: ${toolId}`)
          log.dim('Run "ultimatrix tools calibrate" to generate profiles.')
          return
        }

        log.info(`\nTool Profile: ${toolId}\n`)
        log.info(`  Avg model calls: ${profile.avgModelCalls}`)
        log.info(`  Avg input tokens: ${profile.avgInputTokens}`)
        log.info(`  Avg output tokens: ${profile.avgOutputTokens}`)
        log.info(`  Sample count: ${profile.sampleCount}`)
        if (profile.estimated) log.info(`  (estimated)`)
        break
      }

      // Show all profiles
      const profiles = profiler.getAllProfiles()
      if (profiles.length === 0) {
        log.info('No tool profiles found. Run "ultimatrix tools calibrate" first.')
        return
      }

      log.info(`\nTool Token Profiles (${profiles.length} tools):\n`)
      log.info('  Tool ID                  | Avg Calls | Avg In   | Avg Out  | Samples')
      log.info('  -------------------------|-----------|----------|----------|--------')
      for (const p of profiles.sort((a, b) => b.sampleCount - a.sampleCount)) {
        const id = p.toolId.padEnd(25)
        const calls = String(p.avgModelCalls).padStart(5)
        const inp = String(p.avgInputTokens).padStart(6)
        const out = String(p.avgOutputTokens).padStart(6)
        const samp = String(p.sampleCount).padStart(6)
        log.info(`  ${id} | ${calls}     | ${inp}   | ${out}   | ${samp}`)
      }
      break
    }

    case 'calibrate': {
      const profiler = new TokenProfiler()
      const defaults = profiler.getAllProfiles()

      log.info('\nTool Calibration:\n')
      log.dim('Token profiles are collected automatically during normal usage.')
      log.dim('Each tool execution updates the EMA (exponential moving average) profile.\n')

      log.info('Default/Estimated Profiles:')
      log.info('  Tool ID                  | Calls | In     | Out    | Status')
      log.info('  -------------------------|-------|--------|--------|--------')
      for (const p of defaults.filter(p => p.estimated).sort((a, b) => a.toolId.localeCompare(b.toolId))) {
        const id = p.toolId.padEnd(25)
        const calls = String(p.avgModelCalls.toFixed(1)).padStart(5)
        const inp = String(p.avgInputTokens).padStart(6)
        const out = String(p.avgOutputTokens).padStart(6)
        log.info(`  ${id} | ${calls} | ${inp} | ${out} | estimated`)
      }

      log.info(`\n  ${defaults.filter(p => !p.estimated).length} tool(s) have empirical data.`)
      log.dim('\nRun a scan or interact session to collect real calibration data.')
      break
    }

    default:
      log.info('Usage: ultimatrix tools <profile|calibrate> [--tool <toolId>]')
  }
}
