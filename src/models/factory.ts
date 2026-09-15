import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { PROVIDER_INFO, resolveProviderAlias } from '../config'
import type { UltimatrixConfig } from '../config'
import { getSanitizeKeywords, sanitizeRequestBody } from './schema-sanitizer'
import { wrapModel } from './middleware'
import type { ModelSelector } from './selector'
import { resolveModelRef, type ModelRole, type TaskComplexity } from './routing'
import { log } from '../utils/logger'

/**
 * Resolve a model for a tier, role, or explicit model ID.
 * Returns an actual AI SDK LanguageModelV2 instance, not a config object.
 */
export function resolveModel(
  config: UltimatrixConfig,
  tierOrOptions?: 'fast' | 'balanced' | 'powerful' | 'default' | {
    modelId?: string
    tier?: string
    selector?: ModelSelector
    role?: ModelRole
    complexity?: TaskComplexity
  },
): LanguageModelV2 {
  const route = typeof tierOrOptions === 'string'
    ? resolveModelRef(config, { tier: tierOrOptions })
    : resolveModelRef(config, tierOrOptions ?? {})

  log.dim(`Resolving model: ${route.provider}/${route.model} (${route.tier}: ${route.reason})`)

  return buildModel(config, route.provider, route.model)
}

/**
 * Build a LanguageModelV2 instance.
 * `modelId` is the exact string the user provided; it goes straight to the API.
 */
function buildModel(
  config: UltimatrixConfig,
  provider: string,
  modelId: string,
): LanguageModelV2 {
  const baseProvider = resolveProviderAlias(provider)
  const creds = config.creds?.[provider] ?? config.creds?.[baseProvider] ?? config.providerKeys?.[provider]
  const info = PROVIDER_INFO[baseProvider]
  const keywords = getSanitizeKeywords(baseProvider)

  const transformRequestBody = keywords
    ? (body: Record<string, unknown>) => sanitizeRequestBody(body, keywords)
    : undefined
  let model: LanguageModelV2

  if (!info) {
    log.warn(`[resolveModel] Unknown provider "${provider}" - creating client with no base URL. Set creds.${provider} or use a known provider.`)
    model = createOpenAICompatible({
      name: provider,
      baseURL: 'https://localhost',
      apiKey: '',
      transformRequestBody,
    }).chatModel(modelId)
  } else {
    switch (baseProvider) {
      case 'azure': {
        const az = creds as import('../config').AzureCreds | undefined
        const apiKey = az?.apiKey || ''
        const endpoint = az?.endpoint || info.defaultBaseUrl
        model = createOpenAICompatible({
          name: 'azure',
          baseURL: endpoint,
          apiKey,
          headers: az?.apiVersion ? { 'api-version': az.apiVersion } : undefined,
          transformRequestBody,
        }).chatModel(modelId)
        break
      }

      case 'bedrock': {
        const br = creds as import('../config').BedrockCreds | undefined
        if (br) {
          if (br.authMethod === 'api_key' && br.apiKey) {
            process.env.AWS_BEARER_TOKEN_BEDROCK = br.apiKey
          } else if (br.authMethod === 'iam') {
            if (br.accessKeyId) process.env.AWS_ACCESS_KEY_ID = br.accessKeyId
            if (br.secretAccessKey) process.env.AWS_SECRET_ACCESS_KEY = br.secretAccessKey
            if (br.sessionToken) process.env.AWS_SESSION_TOKEN = br.sessionToken
            if (br.region) process.env.AWS_REGION = br.region
          }
        }
        model = createOpenAICompatible({
          name: 'bedrock',
          baseURL: info.defaultBaseUrl,
          apiKey: '',
          transformRequestBody,
        }).chatModel(modelId)

        if (br?.authMethod === 'api_key') {
          delete process.env.AWS_BEARER_TOKEN_BEDROCK
        } else if (br?.authMethod === 'iam') {
          delete process.env.AWS_ACCESS_KEY_ID
          delete process.env.AWS_SECRET_ACCESS_KEY
          delete process.env.AWS_SESSION_TOKEN
          delete process.env.AWS_REGION
        }
        break
      }

      default: {
        const apiKeyCreds = creds as import('../config').ApiKeyCreds | undefined
        // Parity with browser/CLI paths: fall back to the provider env var
        // (e.g. GROQ_API_KEY) so a model works when the key lives in env.
        const apiKey = apiKeyCreds?.apiKey || process.env[info.envVar] || ''
        const baseUrl = apiKeyCreds?.baseUrl || info.defaultBaseUrl

        model = createOpenAICompatible({
          name: provider,
          baseURL: baseUrl,
          apiKey,
          transformRequestBody,
        }).chatModel(modelId)
        break
      }
    }
  }

  return wrapModel(model, config)
}
