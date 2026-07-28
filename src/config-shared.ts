// Client-safe config types and constants — no Node.js imports.

export interface ApiKeyCreds {
  apiKey: string
  baseUrl?: string
}

export interface AzureCreds {
  apiKey: string
  endpoint: string
  deployment: string
  apiVersion: string
}

export interface BedrockCreds {
  authMethod: 'iam' | 'api_key'
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region: string
  apiKey?: string
}

export interface CustomCreds {
  apiKey: string
  baseUrl: string
}

export type ProviderCredentials = {
  openai?: ApiKeyCreds
  anthropic?: ApiKeyCreds
  google?: ApiKeyCreds
  nvidia?: ApiKeyCreds
  groq?: ApiKeyCreds
  together?: ApiKeyCreds
  deepseek?: ApiKeyCreds
  mistral?: ApiKeyCreds
  xai?: ApiKeyCreds
  perplexity?: ApiKeyCreds
  cerebras?: ApiKeyCreds
  deepinfra?: ApiKeyCreds
  openrouter?: ApiKeyCreds
  bedrock?: BedrockCreds
  azure?: AzureCreds
  custom?: CustomCreds
  [key: string]: ApiKeyCreds | AzureCreds | BedrockCreds | CustomCreds | undefined
}

export interface ProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  envVar: string
}

export const PROVIDER_INFO: Record<string, ProviderInfo> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    envVar: 'ANTHROPIC_API_KEY',
  },
  google: {
    id: 'google',
    name: 'Google (Gemini)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    envVar: 'NVIDIA_API_KEY',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    envVar: 'TOGETHER_API_KEY',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    envVar: 'MISTRAL_API_KEY',
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    defaultBaseUrl: 'https://api.x.ai/v1',
    envVar: 'XAI_API_KEY',
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    defaultBaseUrl: 'https://api.perplexity.ai',
    envVar: 'PERPLEXITY_API_KEY',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    envVar: 'CEREBRAS_API_KEY',
  },
  deepinfra: {
    id: 'deepinfra',
    name: 'DeepInfra',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    envVar: 'DEEPINFRA_API_KEY',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
  },
  azure: {
    id: 'azure',
    name: 'Azure OpenAI',
    defaultBaseUrl: '',
    envVar: 'AZURE_API_KEY',
  },
  bedrock: {
    id: 'bedrock',
    name: 'AWS Bedrock',
    defaultBaseUrl: '',
    envVar: 'AWS_ACCESS_KEY_ID',
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    defaultBaseUrl: 'https://api.cohere.com/v2',
    envVar: 'COHERE_API_KEY',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    envVar: 'OLLAMA_API_KEY',
  },
}
