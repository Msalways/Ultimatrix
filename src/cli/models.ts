import { loadConfig, type ModelCapabilities } from '../config'
import { log } from '../utils/logger'
import { resolveModel } from '../models/factory'

export async function modelsCommand(args: string[]): Promise<void> {
  const sub = args[0] || 'list'

  switch (sub) {
    case 'list': {
      const config = loadConfig()
      const caps = config.modelCapabilities || {}
      const tiers = config.modelTiers || {}

      const modelIds = Object.keys(caps)

      if (modelIds.length === 0) {
        log.info('No models configured.')
        log.dim('Set modelCapabilities in ultimatrix.yaml or run "ultimatrix init" to configure.')
        log.dim(`Default model: ${config.provider}/${config.model}`)
        return
      }

      // Build tier → model reverse map
      const tierByModel = new Map<string, string>()
      for (const [tier, tierCfg] of Object.entries(tiers)) {
        if (tierCfg) {
          const fullId = `${tierCfg.provider}/${tierCfg.model}`
          tierByModel.set(fullId, tier)
        }
      }

      log.info('\nConfigured Models:\n')
      for (const id of modelIds) {
        const cap = caps[id]
        const tier = tierByModel.get(id)
        const tierLabel = tier ? ` [${tier}]` : ''
        const defaultLabel = id === `${config.provider}/${config.model}` || id === config.model ? ' (default)' : ''

        if (cap) {
          log.info(`  ${id}${tierLabel}${defaultLabel}`)
          log.info(`    Context: ${cap.contextWindow.toLocaleString()} tokens`)
          log.info(`    Max output: ${cap.maxOutputTokens.toLocaleString()} tokens`)
          log.info(`    Streaming: ${cap.supportsStreaming ? 'yes' : 'no'}`)
          log.info(`    Strengths: ${cap.strengths.join(', ') || 'none listed'}`)
        } else {
          log.info(`  ${id}${tierLabel}${defaultLabel} (no capabilities configured)`)
        }
      }

      log.info(`\nDefault model: ${config.provider}/${config.model}`)
      break
    }

    case 'test': {
      const modelId = args[1]
      if (!modelId) {
        log.error('Usage: ultimatrix models test <modelId>')
        process.exit(1)
      }

      log.info(`Testing model: ${modelId}...`)
      try {
        const config = loadConfig()
        const model = resolveModel(config, { modelId })
        const result = await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say "hello" in one word.' }] }],
          maxOutputTokens: 10,
        })
        log.success(`Model responded: ${(result as any).text ?? (result as any).content?.[0]?.text ?? JSON.stringify(result)}`)
      } catch (err) {
        log.error(`Model test failed: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
      break
    }

    default:
      log.info('Usage: ultimatrix models <list|test> [modelId]')
  }
}
