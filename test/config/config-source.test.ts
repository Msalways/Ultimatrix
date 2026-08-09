import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dump } from 'js-yaml'
import {
  getConfigPath,
  getProvidersPath,
  loadConfig,
  migrateLegacyCredentialsToProject,
  saveProjectConfig,
  saveProvidersConfig,
  validateConfig,
} from '../../src/config'
import { getWebConfig, maskCredentials, saveWebConfig } from '../../src/web/config-bridge'

describe('canonical project configuration', () => {
  let root: string
  let previousConfigPath: string | undefined
  let previousGroqKey: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ultimatrix-config-'))
    previousConfigPath = process.env.ULTIMATRIX_CONFIG
    previousGroqKey = process.env.GROQ_API_KEY
    delete process.env.ULTIMATRIX_CONFIG
    delete process.env.GROQ_API_KEY
  })

  afterEach(() => {
    if (previousConfigPath === undefined) delete process.env.ULTIMATRIX_CONFIG
    else process.env.ULTIMATRIX_CONFIG = previousConfigPath
    if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = previousGroqKey
    rmSync(root, { recursive: true, force: true })
  })

  it('finds the nearest ultimatrix.yaml from a project subdirectory', () => {
    const nested = join(root, 'src', 'feature')
    mkdirSync(nested, { recursive: true })
    const expected = join(root, 'ultimatrix.yaml')
    writeFileSync(expected, 'provider: groq\nmodel: test\n', 'utf-8')

    expect(getConfigPath(nested)).toBe(expected)
    expect(getProvidersPath(nested)).toBe(join(root, 'providers.yaml'))
  })

  it('round-trips behavioral config identically for CLI and web', async () => {
    const path = join(root, 'ultimatrix.yaml')
    process.env.ULTIMATRIX_CONFIG = path
    process.env.GROQ_API_KEY = 'test-secret'

    const config = validateConfig({
      provider: 'groq',
      model: 'test-model',
      creds: { groq: { apiKey: 'test-secret' } },
      solver: { maxToolCalls: 12, maxRounds: 7, maxActiveChainSteps: 0 },
      interaction: { showReasoning: false, showSystemEvents: true, chat: true },
      compression: { headroom: { enabled: true, tokenBudget: 42_000 } },
      truncation: { maxResponseSize: 12_000, fallbackEnabled: false },
      context: { maxEndpointsInSummary: 17, maxFindingsPerTurn: 9 },
      rateLimit: {
        requestsPerMinute: 15,
        maxConcurrent: 2,
        retryOnLimit: true,
        maxRetries: 3,
        backoffStrategy: 'fixed',
        backoffSteps: [1000],
        baseBackoffMs: 1000,
        maxBackoffMs: 1000,
        useHeaders: false,
      },
      credentials: { admin: { email: 'admin@example.com', password: 'test-password' } },
    })

    saveProjectConfig(config)
    saveProvidersConfig(config.creds)
    const cliConfig = loadConfig()
    const webConfig = await getWebConfig()

    expect(webConfig).toEqual(cliConfig)
    expect(cliConfig.solver).toMatchObject({ maxRounds: 7, maxActiveChainSteps: 0 })
    expect(cliConfig.interaction?.showReasoning).toBe(false)
    expect(cliConfig.compression?.headroom?.tokenBudget).toBe(42_000)
    expect(cliConfig.truncation?.fallbackEnabled).toBe(false)
    expect(cliConfig.context?.maxEndpointsInSummary).toBe(17)
    expect(cliConfig.rateLimit.backoffStrategy).toBe('fixed')
    expect(cliConfig.credentials?.admin.email).toBe('admin@example.com')
  })

  it('lets web settings repair missing credentials while runtime remains strict', async () => {
    const path = join(root, 'ultimatrix.yaml')
    process.env.ULTIMATRIX_CONFIG = path
    writeFileSync(path, dump({ provider: 'groq', model: 'test-model' }), 'utf-8')

    expect(() => loadConfig()).toThrow('creds.groq is required')
    await expect(getWebConfig()).resolves.toMatchObject({
      provider: 'groq',
      model: 'test-model',
      creds: {},
    })
  })

  it('keeps project providers.yaml authoritative over environment variables', () => {
    const path = join(root, 'ultimatrix.yaml')
    process.env.ULTIMATRIX_CONFIG = path
    process.env.GROQ_API_KEY = 'environment-key'
    writeFileSync(path, dump({ provider: 'groq', model: 'test-model' }), 'utf-8')
    writeFileSync(getProvidersPath(), dump({ groq: { apiKey: 'provider-file-key' } }), 'utf-8')

    expect(loadConfig().creds.groq?.apiKey).toBe('provider-file-key')
  })

  it('preserves masked secrets and replaces the provider map on web save', async () => {
    const path = join(root, 'ultimatrix.yaml')
    process.env.ULTIMATRIX_CONFIG = path
    const config = validateConfig({
      provider: 'groq',
      model: 'test-model',
      creds: {
        groq: { apiKey: 'groq-secret-key' },
        openrouter: { apiKey: 'openrouter-secret-key' },
      },
    })
    saveProjectConfig(config)
    saveProvidersConfig(config.creds)

    const masked = maskCredentials(await getWebConfig()) as unknown as Record<string, any>
    delete masked.creds.openrouter
    expect((await saveWebConfig(masked)).ok).toBe(true)

    const saved = loadConfig()
    expect(saved.creds.groq?.apiKey).toBe('groq-secret-key')
    expect(saved.creds.openrouter).toBeUndefined()
  })

  it('replaces an existing provider key through web settings', async () => {
    const path = join(root, 'ultimatrix.yaml')
    process.env.ULTIMATRIX_CONFIG = path
    const config = validateConfig({
      provider: 'groq',
      model: 'test-model',
      creds: { groq: { apiKey: 'original-key' } },
    })
    saveProjectConfig(config)
    saveProvidersConfig(config.creds)

    const web = maskCredentials(await getWebConfig()) as unknown as Record<string, any>
    web.creds.groq.apiKey = 'replacement-key'
    expect((await saveWebConfig(web)).ok).toBe(true)
    expect(loadConfig().creds.groq?.apiKey).toBe('replacement-key')
  })

  it('migrates inline and legacy credentials into project providers.yaml', () => {
    const path = join(root, 'ultimatrix.yaml')
    const legacyPath = join(root, 'legacy-providers.yaml')
    process.env.ULTIMATRIX_CONFIG = path
    writeFileSync(path, dump({
      provider: 'groq',
      model: 'test-model',
      creds: { groq: { apiKey: 'project-key' } },
    }), 'utf-8')
    writeFileSync(legacyPath, dump({
      groq: { apiKey: 'legacy-key' },
      nvidia: { apiKey: 'nvidia-key' },
    }), 'utf-8')

    const result = migrateLegacyCredentialsToProject(legacyPath)
    expect(result.migrated).toEqual(['groq', 'nvidia'])
    expect(result.skipped).toEqual(['groq'])
    expect(loadConfig().creds.groq?.apiKey).toBe('project-key')
    expect(loadConfig().creds.nvidia?.apiKey).toBe('nvidia-key')
    expect(readFileSync(path, 'utf-8')).not.toContain('project-key')
  })
})
