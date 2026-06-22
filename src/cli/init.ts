import * as readline from 'readline'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { dump, load } from 'js-yaml'
import { PROVIDER_INFO } from '../config'
import { log } from '../utils/logger'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function ask(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve))
}

function providersPath(): string {
  return join(homedir(), '.config', 'ultimatrix', 'providers.yaml')
}

function ensureDir(path: string) {
  const dir = path.substring(0, path.lastIndexOf('\\'))
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

async function testConnection(url: string, model: string, apiKey: string): Promise<boolean> {
  try {
    const t0 = Date.now()
    const res = await fetch(url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.error('Connection failed: ' + res.status + ' ' + body.slice(0, 100))
      return false
    }
    const elapsed = Date.now() - t0
    log.success('Connection OK (' + elapsed + 'ms)')
    return true
  } catch (e) {
    log.error('Connection failed: ' + (e as Error).message)
    return false
  }
}

export async function initWizard() {
  log.banner('Ultimatrix Init — LLM Provider Setup')

  const providerList = Object.values(PROVIDER_INFO)

  // 1. Pick provider
  log.info('Pick a provider:')
  for (let i = 0; i < providerList.length; i++) {
    log.raw('  ' + (i + 1) + ') ' + providerList[i].name)
  }
  const pickRaw = await ask('Number or name > ')
  const pickNum = parseInt(pickRaw, 10)
  const provider = pickNum >= 1 && pickNum <= providerList.length
    ? providerList[pickNum - 1]
    : providerList.find((p) => p.name.toLowerCase().startsWith(pickRaw.toLowerCase())) || providerList[providerList.length - 1]

  log.info('  Selected: ' + provider.name)

  // 2. Model name (free-form)
  const model = await ask('Model name (e.g. gpt-4o, llama3-8b-8192) > ')
  if (!model.trim()) {
    log.error('Model name is required.')
    rl.close()
    return
  }
  const modelId = model.trim()

  // 3. Base URL
  const defaultUrl = provider.defaultBaseUrl
  const urlInput = await ask('Base URL' + (defaultUrl ? ' [' + defaultUrl + ']' : '') + ' > ')
  const baseUrl = urlInput.trim() || defaultUrl

  // 4. API key
  const apiKey = await ask('API key > ')
  if (!apiKey.trim()) {
    log.error('API key is required.')
    rl.close()
    return
  }

  // 5. Optional test
  const testRaw = await ask('Test connection? [Y/n] > ')
  if (testRaw.toLowerCase() !== 'n') {
    if (baseUrl) {
      await testConnection(baseUrl, modelId, apiKey.trim())
    } else {
      log.warn('No base URL available to test.')
    }
  }

  // 6. Write providers.yaml
  const configDir = providersPath()
  ensureDir(configDir)
  let providersData: Record<string, unknown> = {}
  if (existsSync(configDir)) {
    try {
      const existing = load(readFileSync(configDir, 'utf-8'))
      if (existing && typeof existing === 'object') providersData = existing as Record<string, unknown>
    } catch { /* ignore */ }
  }

  providersData[provider.id] = {
    apiKey: apiKey.trim(),
    ...(baseUrl ? { baseUrl } : {}),
  }

  writeFileSync(configDir, dump(providersData), 'utf-8')
  log.success('Saved provider config to ' + configDir)

  // 7. Optional: write ultimatrix.yaml
  const saveProject = await ask('Save project config to ./ultimatrix.yaml? [Y/n] > ')
  if (saveProject.toLowerCase() !== 'n') {
    const projectPath = resolve('ultimatrix.yaml')
    let projectData: Record<string, unknown> = {}
    if (existsSync(projectPath)) {
      try {
        const existing = load(readFileSync(projectPath, 'utf-8'))
        if (existing && typeof existing === 'object') projectData = existing as Record<string, unknown>
      } catch { /* ignore */ }
    }
    projectData.provider = provider.id
    projectData.model = modelId

    if (!projectData.browser) {
      projectData.browser = {
        headless: true,
        viewport: { width: 1280, height: 720 },
        domSettleTimeout: 5000,
        env: 'LOCAL',
        selfHeal: true,
        verbose: 0,
      }
    }
    if (!projectData.memory) {
      projectData.memory = {
        lastMessages: 10,
        semanticRecall: false,
        workingMemory: true,
      }
    }
    if (!projectData.agent) {
      projectData.agent = {
        maxSteps: 50,
        scansDir: './scans',
      }
    }

    writeFileSync(projectPath, dump(projectData), 'utf-8')
    log.success('Saved to ' + projectPath)
  }

  log.nl()
  log.success('Done. Run `npm start` to begin.')
  rl.close()
}
