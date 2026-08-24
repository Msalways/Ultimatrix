import { loadConfig, saveProjectConfig } from '../config'
import { log } from '../utils/logger'
import { resolveModel } from '../models/factory'
import { splitModelId, type ModelRole } from '../models/routing'
import { resolveEffectiveConfig } from '../models/effective-config'
import type { ModelModuleRole, ModelTierName } from '../config'

const STATIC_ROLES = new Set<ModelRole>(['brain', 'spider', 'crawlSummarizer', 'verifier', 'reporter', 'council'])
const TIER_KEYS = new Set<ModelTierName>(['fast', 'balanced', 'powerful'])

function readPositiveFlag(args: string[], name: string): number | undefined {
  const idx = args.indexOf(name)
  if (idx === -1) return undefined
  const raw = args[idx + 1]
  const value = Number(raw)
  if (!raw || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

function modelArg(args: string[]): string | undefined {
  return args.find((arg, idx) => idx > 0 && !arg.startsWith('--'))
}

function printEffective(config: ReturnType<typeof loadConfig>): void {
  const effective = resolveEffectiveConfig(config)
  log.info(`\nConfig health: ${effective.status}\n`)
  for (const error of effective.errors) log.error(`  ${error}`)
  for (const warning of effective.warnings) log.warn(`  ${warning}`)
  log.info('\nTiers:')
  for (const tier of ['fast', 'balanced', 'powerful'] as const) {
    const route = effective.tiers[tier]
    const cap = route.capability
    log.info(`  ${tier.padEnd(9)} ${route.modelId}  ${cap ? `${cap.contextWindow.toLocaleString()} ctx / ${cap.maxOutputTokens.toLocaleString()} out` : 'unknown limits'}`)
  }
  log.info('\nModules:')
  for (const role of ['brain', 'spider', 'crawlSummarizer', 'verifier', 'reporter', 'council'] as const) {
    const route = effective.modules[role]
    log.info(`  ${role.padEnd(15)} ${route.tier.padEnd(8)} ${route.modelId}${route.advancedOverride ? '  advanced override' : ''}`)
  }
  log.info('\nWorkers: low→fast, medium→balanced, high/critical→powerful')
}

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

    case 'validate': {
      const config = loadConfig()
      printEffective(config)
      break
    }

    case 'tier': {
      const config = loadConfig()
      const tier = args[1] as ModelTierName
      const id = args[2]
      if (!TIER_KEYS.has(tier) || !id) throw new Error('Usage: ultimatrix models tier <fast|balanced|powerful> <provider/model>')
      const split = splitModelId(id, config.provider)
      config.modelTiers = {
        ...(config.modelTiers ?? {}),
        [tier]: { provider: split.provider, model: split.model },
      }
      saveProjectConfig(config)
      log.success(`Set ${tier} tier to ${split.provider}/${split.model}`)
      break
    }

    case 'module': {
      const config = loadConfig()
      const role = args[1] as ModelModuleRole
      const tier = args[2] as ModelTierName
      if (!STATIC_ROLES.has(role as ModelRole) || !TIER_KEYS.has(tier)) throw new Error('Usage: ultimatrix models module <brain|spider|crawlSummarizer|verifier|reporter|council> <fast|balanced|powerful>')
      config.modelRoleTiers = {
        ...(config.modelRoleTiers ?? {}),
        [role]: tier,
      }
      saveProjectConfig(config)
      log.success(`Set ${role} module to ${tier} tier`)
      break
    }

    case 'route': {
      const config = loadConfig()
      const first = args[1]
      if (args.includes('--max-output') || args.includes('--context')) {
        throw new Error('Token limits belong to model capabilities. Use: ultimatrix models capability <provider/model> --context n --max-output n')
      }

      if (!first) {
        log.error('Usage: ultimatrix models route <role> <provider/model>')
        log.error('Prefer: ultimatrix models module <role> <fast|balanced|powerful>')
        process.exit(1)
      }

      const role = first as ModelRole
      if (!STATIC_ROLES.has(role)) throw new Error(`Unknown model role: ${first}. Worker routing is internal; configure tiers instead.`)
      const id = modelArg(args.slice(1))

      if (!id) throw new Error('Missing model id. Use provider/model, for example openai/gpt-4o')
      const split = splitModelId(id, config.provider)
      const route = {
        provider: split.provider,
        model: split.model,
      }
      config.modelRoles = {
        ...(config.modelRoles ?? {}),
        [role]: route,
      }

      saveProjectConfig(config)
      log.success(`Advanced override: routed ${role} to ${route.provider}/${route.model}`)
      log.dim('Prefer tier/module routing unless this module really needs a raw model.')
      break
    }

    case 'capability':
    case 'cap': {
      const config = loadConfig()
      const id = args[1]
      if (!id) throw new Error('Usage: ultimatrix models capability <provider/model> --context n --max-output n')
      const contextWindow = readPositiveFlag(args, '--context')
      const maxOutputTokens = readPositiveFlag(args, '--max-output')
      if (!contextWindow && !maxOutputTokens) throw new Error('Set at least --context or --max-output')

      const split = splitModelId(id, config.provider)
      const modelId = `${split.provider}/${split.model}`
      const current = config.modelCapabilities?.[modelId] ?? config.modelCapabilities?.[split.model]
      const next = {
        contextWindow: contextWindow ?? current?.contextWindow ?? 8192,
        maxOutputTokens: maxOutputTokens ?? current?.maxOutputTokens ?? 2048,
        strengths: current?.strengths ?? [],
        supportsStreaming: current?.supportsStreaming ?? true,
        supportsStructuredOutput: current?.supportsStructuredOutput ?? false,
        ...(current?.supportsVision !== undefined ? { supportsVision: current.supportsVision } : {}),
        ...(current?.reservedMargin !== undefined ? { reservedMargin: current.reservedMargin } : {}),
      }

      config.modelCapabilities = {
        ...(config.modelCapabilities ?? {}),
        [modelId]: next,
      }
      saveProjectConfig(config)
      log.success(`Updated capabilities for ${modelId}`)
      log.dim(`${next.contextWindow.toLocaleString()} ctx / ${next.maxOutputTokens.toLocaleString()} out`)
      break
    }

    default:
      log.info('Usage: ultimatrix models <list|validate|tier|module|capability|test> ...')
  }
}
