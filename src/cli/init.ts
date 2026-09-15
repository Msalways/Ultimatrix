import { select, input, password, confirm } from '@inquirer/prompts'
import { PROVIDER_INFO, lookupModelDefaults } from '../config'
import { log } from '../utils/logger'
import type { EngineType } from '../config'
import { runSetup, testProviderConnection } from '../core/setup-service'
import { THEME, BOX } from '../ui/theme'

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

function boxSummary(title: string, lines: string[]): void {
  const maxLen = Math.max(title.length + 4, ...lines.map(l => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length))
  const w = maxLen + 4
  const b = BOX.single
  const d = THEME.dim
  const r = THEME.reset
  const results: string[] = []
  results.push(`  ${d}${b.tl}${b.h} ${THEME.bold}${title}${r} ${d}${b.h.repeat(Math.max(0, w - title.length - 3))}${b.tr}${r}`)
  for (const line of lines) {
    const visLen = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length
    const pad = Math.max(0, maxLen - visLen)
    results.push(`  ${d}${b.v}${r}  ${line}${' '.repeat(pad)}  ${d}${b.v}${r}`)
  }
  results.push(`  ${d}${b.bl}${b.h.repeat(w - 1)}${b.br}${r}`)
  for (const l of results) log.raw(l)
}

// ─── Main wizard ───────────────────────────────────────────────────

export async function initWizard() {
  const opts = parseArgs()

  // ─── Banner ──────────────────────────────────────────────────────
  log.nl()
  log.raw('  ULTIMATRIX')
  log.raw('  security research platform')
  log.nl()

  // ─── Phase 1: Auto-detect + Configure ────────────────────────────
  // Detect available API keys from environment
  const detectedKeys: string[] = []
  for (const [providerId, info] of Object.entries(PROVIDER_INFO)) {
    if (process.env[info.envVar]) detectedKeys.push(providerId)
  }
  if (detectedKeys.length > 0) {
    log.raw(`  ${THEME.dim}detected: ${detectedKeys.join(', ')}${THEME.reset}`)
    log.nl()
  }

  let selectedProvider: (typeof PROVIDER_INFO)[string] | undefined
  let modelId: string
  let apiKey: string
  let baseUrl: string
  let contextWindow = 8192
  let maxOutputTokens = 2048

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

    // Smart defaults for known models
    const defaults = lookupModelDefaults(modelId)
    if (defaults) { contextWindow = defaults.contextWindow; maxOutputTokens = defaults.maxOutputTokens }

    if (!apiKey) {
      log.error(`No API key found. Set ${providerInfo.envVar} or use --key`)
      return
    }
  } else if (opts.nonInteractive) {
    log.error('Non-interactive mode requires --provider and --model flags')
    return
  } else {
    // Interactive: auto-detect if single key, otherwise prompt
    if (detectedKeys.length === 1) {
      const autoProvider = detectedKeys[0]
      selectedProvider = Object.values(PROVIDER_INFO).find(p => p.id === autoProvider)
      apiKey = process.env[selectedProvider!.envVar]!
      baseUrl = selectedProvider!.defaultBaseUrl
      log.raw(`  ${THEME.dim}auto-selecting ${autoProvider} (only key detected)${THEME.reset}`)
      modelId = await input({
        message: 'Model name',
        validate: (v) => v.trim().length > 0 || 'Model name is required',
      })
      modelId = modelId.trim()
      const defaults = lookupModelDefaults(modelId)
      if (defaults) { contextWindow = defaults.contextWindow; maxOutputTokens = defaults.maxOutputTokens }
      log.raw(`  ${THEME.dim}context: ${contextWindow.toLocaleString()} · output: ${maxOutputTokens.toLocaleString()}${THEME.reset}`)
    } else {
      // Multiple or no keys — prompt for provider
      const providerChoices = Object.values(PROVIDER_INFO).map(p => ({
        name: p.id,
        value: p.id,
        description: process.env[p.envVar] ? ' (env key detected)' : '',
      }))
      const pickedId = await select({ message: 'Provider', choices: providerChoices })
      selectedProvider = Object.values(PROVIDER_INFO).find(p => p.id === pickedId)
      if (!selectedProvider) { log.error(`Unknown provider: ${pickedId}`); return }

      modelId = await input({
        message: 'Model name',
        validate: (v) => v.trim().length > 0 || 'Model name is required',
      })
      modelId = modelId.trim()

      // Smart defaults
      const defaults = lookupModelDefaults(modelId)
      if (defaults) { contextWindow = defaults.contextWindow; maxOutputTokens = defaults.maxOutputTokens }

      // API key
      const envKeyAvailable = !!process.env[selectedProvider.envVar]
      if (envKeyAvailable) {
        apiKey = process.env[selectedProvider.envVar]!
        log.raw(`  ${THEME.dim}key loaded from ${selectedProvider.envVar}${THEME.reset}`)
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
        const urlInput = await input({ message: 'Base URL', default: defaultUrl })
        baseUrl = urlInput.trim() || defaultUrl
      } else {
        baseUrl = await input({
          message: 'Base URL',
          validate: (v) => v.trim().length > 0 || 'Base URL is required for this provider',
        })
        baseUrl = baseUrl.trim()
      }
    }

    // Test connection
    const doTest = await confirm({ message: 'Test connection?', default: true })
    if (doTest) {
      let connected = await testConnection(baseUrl, modelId, apiKey)
      while (!connected) {
        const retry = await confirm({ message: 'Connection failed. Continue anyway?', default: false })
        if (retry) break
        modelId = await input({ message: 'Model name', default: modelId, validate: (v) => v.trim().length > 0 || 'Required' })
        modelId = modelId.trim()
        const urlRetry = await input({ message: 'Base URL', default: baseUrl })
        baseUrl = urlRetry.trim() || baseUrl
        connected = await testConnection(baseUrl, modelId, apiKey)
      }
    }

    // Context/output overrides only if defaults weren't found
    if (!lookupModelDefaults(modelId)) {
      log.nl()
      log.raw(`  ${THEME.dim}no defaults found for ${modelId} — entering manually${THEME.reset}`)
      contextWindow = Number(await input({ message: 'Context window', default: String(contextWindow), validate: (v) => Number(v) > 0 || 'Must be positive' }))
      maxOutputTokens = Number(await input({ message: 'Max output tokens', default: String(maxOutputTokens), validate: (v) => Number(v) > 0 || 'Must be positive' }))
    }
  }

  if (!selectedProvider) { log.error('No provider selected.'); return }

  // ─── Phase 2: Multi-Model + Engine ───────────────────────────────
  // eslint-disable-next-line no-useless-assignment
  let _useMultiModel = false
  const tiers: Record<string, { provider: string; model: string }> = {}
  const crossProviderKeys: Record<string, { apiKey: string; baseUrl?: string }> = {}

  if (!opts.nonInteractive) {
    log.nl()
    _useMultiModel = await confirm({ message: 'Set up multiple models?', default: false })

    if (_useMultiModel) {
      const tierDefs = [
        { key: 'fast', label: 'Fast', hint: 'quick tasks' },
        { key: 'balanced', label: 'Balanced', hint: 'general tasks' },
        { key: 'powerful', label: 'Powerful', hint: 'complex reasoning' },
      ]
      const knownKeys = new Set<string>([selectedProvider.id])

      for (const tier of tierDefs) {
        const providerChoices = Object.values(PROVIDER_INFO).map(p => {
          let desc = ''
          if (process.env[p.envVar]) desc = ' (key available)'
          else if (knownKeys.has(p.id)) desc = ' (configured)'
          return { name: p.id, value: p.id, description: desc }
        })
        providerChoices.push({ name: 'Skip', value: '', description: '' })

        const tierProviderId = await select({ message: `${tier.label} provider (${tier.hint})`, choices: providerChoices })
        if (!tierProviderId) { log.raw(`  ${THEME.dim}${tier.label}: skipped${THEME.reset}`); continue }

        const tierProviderInfo = Object.values(PROVIDER_INFO).find(p => p.id === tierProviderId)
        const tierModel = await input({ message: `${tier.label} model name`, validate: (v) => v.trim().length > 0 || 'Required' })

        let tierKey = process.env[tierProviderInfo?.envVar ?? ''] || ''
        if (!tierKey) {
          if (tierProviderId === selectedProvider.id) tierKey = apiKey
          else {
            tierKey = await password({ message: `API key for ${tierProviderId}`, mask: '*', validate: (v) => v.trim().length > 0 || 'Required' })
            tierKey = tierKey.trim()
          }
        }
        knownKeys.add(tierProviderId)

        let tierBaseUrl: string
        const defaultTierUrl = tierProviderInfo?.defaultBaseUrl
        if (defaultTierUrl) {
          const urlInput = await input({ message: `${tier.label} base URL`, default: defaultTierUrl })
          tierBaseUrl = urlInput.trim() || defaultTierUrl
        } else {
          tierBaseUrl = await input({ message: `${tier.label} base URL`, validate: (v) => v.trim().length > 0 || 'Required' })
          tierBaseUrl = tierBaseUrl.trim()
        }

        if (tierProviderId !== selectedProvider.id || tierBaseUrl !== defaultTierUrl) {
          crossProviderKeys[tierProviderId] = { apiKey: tierKey, baseUrl: tierBaseUrl }
        }
        tiers[tier.key] = { provider: tierProviderId, model: tierModel.trim() }
      }

      // eslint-disable-next-line no-useless-assignment
      if (Object.keys(tiers).length === 0) { _useMultiModel = false }
    }
  }

  let engine: EngineType = 'multi-model'
  if (!opts.nonInteractive) {
    const enginePick = await select({
      message: 'Engine',
      choices: [
        { name: 'Multi-model (recommended)', value: 'multi-model' },
        { name: 'Legacy supervisor (v6)', value: 'legacy' },
      ],
    })
    engine = enginePick as EngineType
  }

  // ─── Phase 3: Save + Summary ─────────────────────────────────────
  if (!opts.nonInteractive) {
    const doSave = await confirm({ message: 'Save config?', default: true })
    if (!doSave) {
      log.dim('Skipped save.')
      printSummary(selectedProvider.id, modelId, engine, tiers, contextWindow, maxOutputTokens)
      return
    }
  }

  const result = await runSetup({
    provider: selectedProvider.id,
    model: modelId,
    apiKey,
    baseUrl,
    engine,
    modelTiers: Object.keys(tiers).length > 0 ? tiers : {
      fast: { provider: selectedProvider.id, model: modelId },
      balanced: { provider: selectedProvider.id, model: modelId },
      powerful: { provider: selectedProvider.id, model: modelId },
    },
    modelCapabilities: {
      [`${selectedProvider.id}/${modelId}`]: {
        contextWindow,
        maxOutputTokens,
        strengths: [],
        supportsStreaming: true,
        supportsStructuredOutput: false,
      },
    },
    modelRoleTiers: {
      brain: 'balanced',
      spider: 'fast',
      crawlSummarizer: 'fast',
      verifier: 'balanced',
      reporter: 'balanced',
      council: 'powerful',
    },
    crossProviderKeys: Object.keys(crossProviderKeys).length > 0 ? crossProviderKeys : undefined,
  })

  if (!result.ok) {
    log.error('Setup failed:')
    for (const e of result.errors ?? []) log.error('  ' + e)
    return
  }

  log.success(`Saved to ${result.configPath}`)
  printSummary(selectedProvider.id, modelId, engine, tiers, contextWindow, maxOutputTokens)
}

function printSummary(provider: string, model: string, engine: EngineType, tiers: Record<string, { provider: string; model: string }>, ctxWin: number, outTok: number): void {
  log.nl()
  const lines = [
    `${THEME.bold}provider${THEME.reset}    ${provider}`,
    `${THEME.bold}model${THEME.reset}       ${provider}/${model}`,
    `${THEME.bold}engine${THEME.reset}       ${engine}`,
    `${THEME.bold}context${THEME.reset}      ${ctxWin.toLocaleString()} tokens`,
    `${THEME.bold}output${THEME.reset}       ${outTok.toLocaleString()} tokens`,
  ]
  if (Object.keys(tiers).length > 0) {
    lines.push('')
    lines.push(`${THEME.bold}tiers${THEME.reset}`)
    for (const [tier, cfg] of Object.entries(tiers)) {
      lines.push(`  ${tier}: ${cfg.provider}/${cfg.model}`)
    }
  }
  boxSummary('Configuration', lines)
  log.nl()
  log.success('Ready. Run `ultimatrix interact -t <url>` to begin.')
}
