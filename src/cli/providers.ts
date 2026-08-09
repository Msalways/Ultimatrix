import { confirm, input, password, select } from '@inquirer/prompts'
import {
  PROVIDER_INFO,
  getProvidersPath,
  loadProvidersConfig,
  resolveProviderAlias,
  saveProvidersConfig,
  type ApiKeyCreds,
  type AzureCreds,
  type BedrockCreds,
  type CustomCreds,
} from '../config'
import { log } from '../utils/logger'

function providerNames(): string[] {
  return Object.keys(PROVIDER_INFO).sort()
}

async function chooseProvider(requested?: string): Promise<string> {
  if (requested) return requested
  return select({
    message: 'Provider',
    choices: providerNames().map((id) => ({ name: PROVIDER_INFO[id].name, value: id })),
  })
}

async function promptSecret(message: string, current?: string): Promise<string> {
  return password({
    message: current ? `${message} (leave blank to keep current)` : message,
    mask: '*',
    validate: (value) => Boolean(value.trim() || current) || `${message} is required`,
  }).then((value) => value.trim() || current || '')
}

async function setProvider(requested?: string): Promise<void> {
  const provider = await chooseProvider(requested)
  const baseProvider = resolveProviderAlias(provider)
  const info = PROVIDER_INFO[baseProvider]
  if (!info) throw new Error(`Unknown provider: ${provider}`)

  const providers = loadProvidersConfig()
  const existing = providers[provider]

  if (baseProvider === 'azure') {
    const current = existing as AzureCreds | undefined
    providers[provider] = {
      apiKey: await promptSecret('API key', current?.apiKey),
      endpoint: await input({ message: 'Endpoint', default: current?.endpoint }),
      deployment: await input({ message: 'Deployment', default: current?.deployment }),
      apiVersion: await input({ message: 'API version', default: current?.apiVersion || '2024-10-21' }),
    } as AzureCreds
  } else if (baseProvider === 'bedrock') {
    const current = existing as BedrockCreds | undefined
    const authMethod = await select({
      message: 'Authentication method',
      default: current?.authMethod || 'iam',
      choices: [
        { name: 'IAM access key', value: 'iam' as const },
        { name: 'Bedrock API key', value: 'api_key' as const },
      ],
    })
    providers[provider] = authMethod === 'api_key'
      ? {
          authMethod,
          apiKey: await promptSecret('API key', current?.apiKey),
          accessKeyId: '',
          secretAccessKey: '',
          region: await input({ message: 'Region', default: current?.region || 'us-east-1' }),
        } as BedrockCreds
      : {
          authMethod,
          accessKeyId: await promptSecret('Access key ID', current?.accessKeyId),
          secretAccessKey: await promptSecret('Secret access key', current?.secretAccessKey),
          sessionToken: await password({ message: 'Session token (optional; blank keeps current)', mask: '*' }).then((v) => v.trim() || current?.sessionToken),
          region: await input({ message: 'Region', default: current?.region || 'us-east-1' }),
        } as BedrockCreds
  } else {
    const current = existing as ApiKeyCreds | CustomCreds | undefined
    const defaultBaseUrl = current?.baseUrl || info.defaultBaseUrl
    providers[provider] = {
      apiKey: await promptSecret('API key', current?.apiKey),
      baseUrl: await input({
        message: 'Base URL',
        default: defaultBaseUrl,
        validate: (value) => baseProvider !== 'custom' || Boolean(value.trim()) || 'Base URL is required',
      }),
    }
  }

  saveProvidersConfig(providers)
  log.success(`Updated ${provider} in ${getProvidersPath()}`)
}

async function removeProvider(requested?: string): Promise<void> {
  const providers = loadProvidersConfig()
  const configured = Object.keys(providers).sort()
  if (configured.length === 0) {
    log.dim('No providers are configured.')
    return
  }
  const provider = requested || await select({
    message: 'Provider to remove',
    choices: configured.map((id) => ({ name: id, value: id })),
  })
  if (!providers[provider]) throw new Error(`Provider is not configured: ${provider}`)
  const approved = await confirm({ message: `Remove credentials for ${provider}?`, default: false })
  if (!approved) {
    log.dim('No changes made.')
    return
  }
  delete providers[provider]
  saveProvidersConfig(providers)
  log.success(`Removed ${provider} from ${getProvidersPath()}`)
}

export async function providersCommand(args: string[]): Promise<void> {
  const action = args[0] || 'list'
  if (action === 'list') {
    const providers = loadProvidersConfig()
    const names = Object.keys(providers).sort()
    log.info(`Provider store: ${getProvidersPath()}`)
    if (names.length === 0) {
      log.dim('No providers are configured.')
      return
    }
    for (const name of names) {
      const entry = providers[name] as ApiKeyCreds | AzureCreds | BedrockCreds | CustomCreds
      const endpoint = 'baseUrl' in entry ? entry.baseUrl : 'endpoint' in entry ? entry.endpoint : undefined
      log.raw(`  ${name}${endpoint ? `  ${endpoint}` : ''}`)
    }
    return
  }
  if (action === 'set') return setProvider(args[1])
  if (action === 'remove') return removeProvider(args[1])
  throw new Error(`Unknown providers action: ${action}. Use list, set, or remove.`)
}
