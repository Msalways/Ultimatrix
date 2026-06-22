import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { PROVIDER_INFO } from '../config'
import type { UltimatrixConfig } from '../config'
import { getSanitizeKeywords, sanitizeRequestBody } from './schema-sanitizer'

/**
 * Resolve which provider credentials to use for a tier string like "groq/llama3-8b-8192".
 * Returns the provider name for credential lookup.
 */
function tierProvider(tierModel: string): string {
  const slashIdx = tierModel.indexOf('/')
  if (slashIdx === -1) return ''
  return tierModel.slice(0, slashIdx)
}

/**
 * Resolve a model for a given tier.
 * Returns an actual AI SDK LanguageModelV2 instance — NOT a config object.
 * The model ID is passed through EXACTLY as-is — no prefixing, no parsing, no stripping.
 */
export function resolveModel(
  config: UltimatrixConfig,
  tier: 'fast' | 'balanced' | 'powerful' | 'default' = 'default',
): LanguageModelV2 {
  const normalisedTier = tier === 'default' ? 'balanced' : tier

  if (config.modelTiers?.[normalisedTier]) {
    const tierModel = config.modelTiers[normalisedTier]!
    const tierProv = tierProvider(tierModel)
    const provider = tierProv || config.provider
    return buildModel(config, provider, tierModel)
  }

  return buildModel(config, config.provider, config.model)
}

/**
 * Build a LanguageModelV2 instance.
 * `modelId` is the EXACT string the user provided — it goes straight to the API.
 */
function buildModel(
  config: UltimatrixConfig,
  provider: string,
  modelId: string,
): LanguageModelV2 {
  const creds = config.creds?.[provider]
  const info = PROVIDER_INFO[provider]
  const keywords = getSanitizeKeywords(provider)

  const transformRequestBody = keywords
    ? (body: Record<string, unknown>) => sanitizeRequestBody(body, keywords)
    : undefined

  if (!info) {
    return createOpenAICompatible({
      name: provider,
      baseURL: 'https://localhost',
      apiKey: '',
      transformRequestBody,
    }).chatModel(modelId)
  }

  switch (provider) {
    case 'azure': {
      const az = creds as import('../config').AzureCreds | undefined
      const apiKey = az?.apiKey || process.env[info.envVar] || ''
      const endpoint = az?.endpoint || info.defaultBaseUrl
      return createOpenAICompatible({
        name: 'azure',
        baseURL: endpoint,
        apiKey,
        headers: az?.apiVersion ? { 'api-version': az.apiVersion } : undefined,
        transformRequestBody,
      }).chatModel(modelId)
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
      return createOpenAICompatible({
        name: 'bedrock',
        baseURL: info.defaultBaseUrl,
        apiKey: '',
        transformRequestBody,
      }).chatModel(modelId)
    }

    default: {
      const apiKeyCreds = creds as import('../config').ApiKeyCreds | undefined
      const apiKey = apiKeyCreds?.apiKey || process.env[info.envVar] || ''
      const baseUrl = apiKeyCreds?.baseUrl || info.defaultBaseUrl

      return createOpenAICompatible({
        name: provider,
        baseURL: baseUrl,
        apiKey,
        transformRequestBody,
      }).chatModel(modelId)
    }
  }
}
