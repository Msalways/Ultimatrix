#!/usr/bin/env node

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { load, dump } from 'js-yaml'

// Lightweight provider configurations
const PROVIDERS = {
  groq: {
    name: 'Groq',
    description: 'Ultra-fast inference with Llama models',
    models: {
      '8b': 'llama-3.1-8b-instruct',
      '70b': 'llama-3.1-70b-instruct'
    },
    envVar: 'GROQ_API_KEY',
    command: 'curl -s https://api.groq.com/openai/v1/models'
  },
  mistral: {
    name: 'Mistral AI',
    description: 'High-performance French models',
    models: {
      '8x7b': 'mixtral-8x7b-instruct-v0.1',
      'large': 'mistral-large-2402-v1:0'
    },
    envVar: 'MISTRAL_API_KEY',
    command: 'curl -s https://api.mistral.ai/v1/models'
  },
  deepseek: {
    name: 'DeepSeek',
    description: 'Strong reasoning capabilities',
    models: {
      'chat': 'deepseek-chat'
    },
    envVar: 'DEEPSEEK_API_KEY',
    command: 'curl -s https://api.deepseek.com/v1/models'
  },
  together: {
    name: 'Together AI',
    description: 'Open-source and commercial models',
    models: {
      'llama-8b': 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'qwen-72b': 'Qwen/Qwen2.5-72B-Instruct'
    },
    envVar: 'TOGETHER_API_KEY',
    command: 'curl -s https://api.together.xyz/v1/models'
  }
}

function checkApiKey(provider: string): boolean {
  const envVar = PROVIDERS[provider].envVar
  return !!process.env[envVar]
}

function testConnection(provider: string): boolean {
  try {
    const command = PROVIDERS[provider].command
    execSync(command, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function generateConfig(provider: string, model: string) {
  const config = {
    model: `${provider}/${model}`,
    target: process.env.TARGET || 'https://example.com',
    depth: 2,
    headless: true,
    timeout: 60000,
    modelTiers: {
      fast: `${provider}/${PROVIDERS[provider].models['8b'] || Object.values(PROVIDERS[provider].models)[0]}`,
      balanced: `${provider}/${PROVIDERS[provider].models['70b'] || Object.values(PROVIDERS[provider].models)[1] || Object.values(PROVIDERS[provider].models)[0]}`,
      powerful: `${provider}/${PROVIDERS[provider].models['large'] || Object.values(PROVIDERS[provider].models)[Object.keys(PROVIDERS[provider].models).length - 1]}`
    }
  }

  const configPath = join(process.cwd(), 'ultimatrix.yaml')
  writeFileSync(configPath, dump(config), 'utf-8')
  
  console.log(`✅ Configuration saved to ultimatrix.yaml`)
  console.log(`🔑 Set environment variable: export ${PROVIDERS[provider].envVar}="your-api-key"`)
  console.log(`🚀 Run: ultimatrix scan -t ${config.target}`)
}

function listProviders() {
  console.log('🤖 Available Lightweight LLM Providers:\n')
  
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const hasKey = checkApiKey(key)
    const works = testConnection(key)
    
    console.log(`${key.toUpperCase()}`)
    console.log(`  Description: ${provider.description}`)
    console.log(`  Models: ${Object.keys(provider.models).join(', ')}`)
    console.log(`  API Key: ${hasKey ? '✅ Set' : '❌ Not set'}`)
    console.log(`  Connection: ${works ? '✅ Working' : '❌ Failed'}`)
    console.log('')
  }
}

function setupProvider(provider: string) {
  if (!PROVIDERS[provider]) {
    console.error(`❌ Provider ${provider} not found`)
    listProviders()
    return
  }

  const hasKey = checkApiKey(provider)
  if (!hasKey) {
    console.error(`❌ API key not set for ${provider}`)
    console.log(`Set your API key: export ${PROVIDERS[provider].envVar}="your-api-key"`)
    return
  }

  const works = testConnection(provider)
  if (!works) {
    console.error(`❌ Connection to ${provider} failed`)
    console.log(`Check your internet connection and API key`)
    return
  }

  console.log(`✅ ${provider} is ready!`)
  console.log(`Available models: ${Object.keys(PROVIDERS[provider].models).join(', ')}`)
  console.log('')
  console.log('To create a configuration:')
  console.log(`node scripts/setup-model.js ${provider} 8b`)
}

if (process.argv.length < 3) {
  console.log('Usage:')
  console.log('  node scripts/setup-model.js list                    # List all providers')
  console.log('  node scripts/setup-model.js setup <provider>        # Setup a provider')
  console.log('  node scripts/setup-model.js config <provider> <model> # Generate config')
  process.exit(1)
}

const command = process.argv[2]

switch (command) {
  case 'list':
    listProviders()
    break
  case 'setup':
    if (process.argv.length < 4) {
      console.error('Please specify a provider')
      process.exit(1)
    }
    setupProvider(process.argv[3])
    break
  case 'config':
    if (process.argv.length < 5) {
      console.error('Please specify provider and model')
      process.exit(1)
    }
    generateConfig(process.argv[3], process.argv[4])
    break
  default:
    console.error('Unknown command')
    process.exit(1)
}