export interface ProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  envVar?: string
  envVarHint: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
    envVarHint: 'OPENAI_API_KEY',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    envVar: 'ANTHROPIC_API_KEY',
    envVarHint: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    envVar: 'NVIDIA_API_KEY',
    envVarHint: 'NVIDIA_API_KEY',
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    envVarHint: 'GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY',
  },
  {
    id: 'groq',
    name: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
    envVarHint: 'GROQ_API_KEY',
  },
  {
    id: 'together',
    name: 'Together AI',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    envVar: 'TOGETHER_API_KEY',
    envVarHint: 'TOGETHER_API_KEY',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    envVarHint: 'OPENROUTER_API_KEY',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    defaultBaseUrl: '',
    envVarHint: 'any API key env var name',
  },
]
