import { select, input, password, confirm } from '@inquirer/prompts'
import { PROVIDER_INFO, getConfigPath, getProvidersPath } from '../config'
import { log } from '../utils/logger'
import type { EngineType } from '../config'
import { runSetup, testProviderConnection } from '../core/setup-service'

// ─── Types ─────────────────────────────────────────────────────────

interface InitOptions {
  provider?: string
  model?: string
  key?: string
  nonInteractive?: boolean
}

// ─── Helpers ───────────────────────────────────────────────────────

async function testConnection(url: string, model: string, apiKey: string): Promise<boolean> {
  const result = await testProviderConnection(url, model, apiKey)
  if (result.ok) {
    log.success('Connection OK (' + result.latencyMs + 'ms)')
  } else {
    log.error('Connection failed: ' + result.error)
  }
  return result.ok
}

function parseArgs(): InitOptions {
  const args = process.argv.slice(2)
  const opts: InitOptions = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) opts.provider = args[++i]
    else if (args[i] === '--model' && args[i + 1]) opts.model = args[++i]
    else if (args[i] === '--key' && args[i + 1]) opts.key = args[++i]
    else if (args[i] === '--non-interactive' || args[i] === '-y') opts.nonInteractive = true
  }
  return opts
}

// ─── Main wizard ───────────────────────────────────────────────────

export async function initWizard() {
  const opts = parseArgs()

  log.banner('Ultimatrix Init')

  // ── Step 1: Provider + Model ──────────────────────────────────────

  let selectedProvider: (typeof PROVIDER_INFO)[string] | undefined
  let modelId: string
  let apiKey: string
  let baseUrl: string

  if (opts.provider && opts.model) {
    // Non-interactive: use CLI args
    const providerInfo = Object.values(PROVIDER_INFO).find(p => p.id === opts.provider)
    if (!providerInfo) {
      log.error(`Unknown provider: ${opts.provider}`)
      log.dim(`Available: ${Object.values(PROVIDER_INFO).map(p => p.id).join(', ')}`)
      return
    }
    selectedProvider = providerInfo
    modelId = opts.model
    apiKey = opts.key || process.env[providerInfo.envVar] || ''
    baseUrl = providerInfo.defaultBaseUrl

    if (!apiKey) {
      log.error(`No API key found. Set ${providerInfo.envVar} or use --key`)
      return
    }
  } else if (opts.nonInteractive) {
    log.error('Non-interactive mode requires --provider and --model flags')
    return
  } else {
    // Interactive wizard
    log.raw('Step 1: Provider & Model')
    log.nl()

    // Build provider choices — show env-detected hint but never pre-select
    const providerChoices = Object.values(PROVIDER_INFO).map(p => ({
      name: p.id,
      value: p.id,
      description: process.env[p.envVar] ? ' (env key detected)' : '',
    }))

    const pickedId = await select({
      message: 'Provider',
      choices: providerChoices,
    })

    selectedProvider = Object.values(PROVIDER_INFO).find(p => p.id === pickedId)
    if (!selectedProvider) {
      log.error(`Unknown provider: ${pickedId}`)
      return
    }

    // Model name
    modelId = await input({
      message: 'Model name',
      validate: (v) => v.trim().length > 0 || 'Model name is required',
    })
    modelId = modelId.trim()

    // API key — load from env or prompt
    const envKeyAvailable = !!process.env[selectedProvider.envVar]
    if (envKeyAvailable) {
      apiKey = process.env[selectedProvider.envVar]!
      log.raw(`  API key loaded from ${selectedProvider.envVar}`)
    } else {
      apiKey = await password({
        message: 'API key',
        mask: '*',
        validate: (v) => v.trim().length > 0 || 'API key is required',
      })
      apiKey = apiKey.trim()
    }

    // Base URL
    const defaultUrl = selectedProvider.defaultBaseUrl
    if (defaultUrl) {
      const urlInput = await input({
        message: 'Base URL (API endpoint)',
        default: defaultUrl,
      })
      baseUrl = urlInput.trim() || defaultUrl
    } else {
      baseUrl = await input({
        message: 'Base URL (API endpoint)',
        validate: (v) => v.trim().length > 0 || 'Base URL is required for this provider',
      })
      baseUrl = baseUrl.trim()
    }

    // Test connection with retry loop
    const doTest = await confirm({
      message: 'Test connection?',
      default: true,
    })
    if (doTest) {
      let connected = await testConnection(baseUrl, modelId, apiKey)
      while (!connected) {
        const retry = await confirm({
          message: 'Connection failed. Continue anyway?',
          default: false,
        })
        if (retry) break

        // Re-ask model name
        modelId = await input({
          message: 'Model name',
          default: modelId,
          validate: (v) => v.trim().length > 0 || 'Model name is required',
        })
        modelId = modelId.trim()

        // Re-ask API key only if not from env
        if (!envKeyAvailable) {
          apiKey = await password({
            message: 'API key',
            mask: '*',
            validate: (v) => v.trim().length > 0 || 'API key is required',
          })
          apiKey = apiKey.trim()
        }

        // Re-ask base URL
        const urlRetry = await input({
          message: 'Base URL (API endpoint)',
          default: baseUrl,
        })
        baseUrl = urlRetry.trim() || baseUrl

        connected = await testConnection(baseUrl, modelId, apiKey)
      }
    }
  }

  if (!selectedProvider) {
    log.error('No provider selected.')
    return
  }

  // ── Step 2: Multi-model? ──────────────────────────────────────────

  let useMultiModel = false
  const tiers: Record<string, { provider: string; model: string }> = {}
  const crossProviderKeys: Record<string, { apiKey: string; baseUrl?: string }> = {}

  if (!opts.nonInteractive) {
    log.nl()
    log.raw('Step 2: Multi-Model Setup')
    log.nl()

    useMultiModel = await confirm({
      message: 'Set up multiple models for different tasks?',
      default: false,
    })

    if (useMultiModel) {
      // ── Step 3: Tier Setup ────────────────────────────────────────
      log.nl()
      log.raw('Step 3: Model Tiers')
      log.dim('  Configure models for different complexity levels.')
      log.nl()

      const tierDefs = [
        { key: 'fast', label: 'Fast', hint: 'quick tasks' },
        { key: 'balanced', label: 'Balanced', hint: 'general tasks' },
        { key: 'powerful', label: 'Powerful', hint: 'complex reasoning' },
      ]

      // Track which providers we already have creds for
      const knownKeys = new Set<string>()
      knownKeys.add(selectedProvider.id)

      for (const tier of tierDefs) {
        // Step 3a: Select provider for this tier
        const providerChoices = Object.values(PROVIDER_INFO).map(p => {
          let desc = ''
          if (process.env[p.envVar]) desc = ' (key available)'
          else if (knownKeys.has(p.id)) desc = ' (configured)'
          return { name: p.id, value: p.id, description: desc }
        })
        providerChoices.push({ name: 'Skip this tier', value: '', description: '' })

        const tierProviderId = await select({
          message: `${tier.label} provider (${tier.hint})`,
          choices: providerChoices,
        })

        if (!tierProviderId) {
          log.dim(`  ${tier.label}: skipped`)
          continue
        }

        const tierProviderInfo = Object.values(PROVIDER_INFO).find(p => p.id === tierProviderId)

        // Step 3b: Input model name
        const tierModel = await input({
          message: `${tier.label} model name`,
          validate: (v) => v.trim().length > 0 || 'Model name is required',
        })

        // Step 3c: Get API key for this provider if needed
        let tierKey = process.env[tierProviderInfo?.envVar ?? ''] || ''

        if (!tierKey) {
          // Reuse primary provider's key if same provider
          if (tierProviderId === selectedProvider.id) {
            tierKey = apiKey
          } else {
            // Cross-provider — need to get a key
            log.warn(`No API key found for ${tierProviderId}`)
            tierKey = await password({
              message: `API key for ${tierProviderId}`,
              mask: '*',
              validate: (v) => v.trim().length > 0 || 'API key is required',
            })
            tierKey = tierKey.trim()
          }
        }
        knownKeys.add(tierProviderId)

        // Step 3d: Get base URL for this provider
        let tierBaseUrl: string
        const defaultTierUrl = tierProviderInfo?.defaultBaseUrl
        if (defaultTierUrl) {
          const urlInput = await input({
            message: `${tier.label} base URL (API endpoint)`,
            default: defaultTierUrl,
          })
          tierBaseUrl = urlInput.trim() || defaultTierUrl
        } else {
          tierBaseUrl = await input({
            message: `${tier.label} base URL (API endpoint)`,
            validate: (v) => v.trim().length > 0 || 'Base URL is required',
          })
          tierBaseUrl = tierBaseUrl.trim()
        }

        // Track cross-provider keys (including base URL) for saving later
        if (tierProviderId !== selectedProvider.id || tierBaseUrl !== defaultTierUrl) {
          crossProviderKeys[tierProviderId] = { apiKey: tierKey, baseUrl: tierBaseUrl }
        }

        tiers[tier.key] = { provider: tierProviderId, model: tierModel.trim() }
        log.raw(`  ${tier.label} → ${tierProviderId}/${tierModel.trim()}`)
      }

      if (Object.keys(tiers).length === 0) {
        log.dim('No tiers configured — using single model.')
        useMultiModel = false
      }
    }
  }

  // ── Step 4: Engine Selection ──────────────────────────────────────

  let engine: EngineType = 'solver'

  if (!opts.nonInteractive) {
    log.nl()
    log.raw('Step 4: Engine')
    log.nl()

    const enginePick = await select({
      message: 'Engine',
      choices: [
        { name: 'Solver (OODA loop)', value: 'solver', description: ' — recommended' },
        { name: 'Multi-model (solver + model selection)', value: 'multi-model' },
        { name: 'Legacy supervisor (v6)', value: 'legacy' },
      ],
    })

    engine = enginePick as EngineType

    if (engine === 'multi-model' && !useMultiModel) {
      log.dim('Note: multi-model engine works best with model tiers. Proceeding anyway.')
    }
  }

  // ── Step 5: Save + Summary ────────────────────────────────────────

  // Save ultimatrix.yaml
  if (!opts.nonInteractive) {
    const doSave = await confirm({
      message: 'Save project config to ./ultimatrix.yaml?',
      default: true,
    })
    if (!doSave) {
      log.dim('Skipped project config save.')
      printSummary(selectedProvider.id, modelId, engine, tiers)
      return
    }
  }

  // Use the shared setup service to write both files
  const result = await runSetup({
    provider: selectedProvider.id,
    model: modelId,
    apiKey,
    baseUrl,
    engine,
    modelTiers: Object.keys(tiers).length > 0 ? tiers : undefined,
    crossProviderKeys: Object.keys(crossProviderKeys).length > 0 ? crossProviderKeys : undefined,
  })

  if (!result.ok) {
    log.error('Setup failed:')
    for (const e of result.errors ?? []) log.error('  ' + e)
    return
  }

  log.success(`Saved provider credentials to ${result.providersPath}`)
  log.success(`Saved to ${result.configPath}`)

  printSummary(selectedProvider.id, modelId, engine, tiers)
}

function printSummary(provider: string, model: string, engine: EngineType, tiers: Record<string, { provider: string; model: string }>): void {
  log.nl()
  log.banner(
    'Configuration Summary',
    `Provider: ${provider}  |  Model: ${model}  |  Engine: ${engine}`,
  )
  if (Object.keys(tiers).length > 0) {
    for (const [tier, tierCfg] of Object.entries(tiers)) {
      log.raw(`  ${tier} → ${tierCfg.provider}/${tierCfg.model}`)
    }
    log.nl()
  }
  log.success('Setup complete. Run `ultimatrix interact -t <url>` to begin.')
}
