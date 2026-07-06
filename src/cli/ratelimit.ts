import { loadConfig } from '../config'
import { log } from '../utils/logger'
import { getGlobalQuotaTracker } from '../models/quota-tracker'
import { getLimiterCacheSize } from '../models/limiter-factory'

export async function ratelimitCommand(args: string[]): Promise<void> {
  const sub = args[0] || 'status'

  switch (sub) {
    case 'status': {
      const config = loadConfig()
      const providerRateLimits = config.providerRateLimits || {}

      log.info('\nRate Limit Status:\n')

      // Show config-based limits
      const providers = Object.keys(providerRateLimits)
      if (providers.length > 0) {
        for (const provider of providers) {
          const rl = providerRateLimits[provider]
          log.info(`  ${provider}:`)
          log.info(`    RPM: ${rl.requestsPerMinute}`)
          if (rl.tokensPerMinute) log.info(`    TPM: ${rl.tokensPerMinute}`)
          log.info(`    Concurrent: ${rl.maxConcurrent}`)
        }
      } else {
        log.info('  No provider-specific rate limits configured.')
        log.info(`  Default RPM: ${config.rateLimit?.requestsPerMinute ?? 15}`)
      }

      // Show quota tracker state
      const quota = getGlobalQuotaTracker()
      const quotaStatus = quota.getStatus()
      const quotaProviders = Object.keys(quotaStatus)
      if (quotaProviders.length > 0) {
        log.info('\n  Quota State:')
        for (const [name, state] of Object.entries(quotaStatus)) {
          log.info(`    ${name}: ${state.inCooldown ? 'COOLDOWN' : 'active'} (used: ${state.used}/${state.limit}, exhaustions: ${state.exhaustionCount})`)
        }
      }

      log.info(`\n  Global max concurrent: ${config.rateLimit?.maxConcurrent ?? 1}`)
      break
    }

    case 'sync': {
      log.info('Syncing rate limits from provider headers...')
      log.dim('(Rate limits are auto-synced from API response headers)')
      log.info('Use "ultimatrix ratelimit status" to view current limits.')
      break
    }

    default:
      log.info('Usage: ultimatrix ratelimit <status|sync>')
  }
}
