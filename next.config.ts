import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: [
    '@mastra/core',
    '@mastra/ai-sdk',
    '@mastra/memory',
    '@mastra/stagehand',
    '@mastra/loggers',
    '@mastra/observability',
    '@nicia-ai/typegraph',
  ],
  outputFileTracingIncludes: {
    '/*': ['./src/**/*'],
  },
  serverExternalPackages: [
    'playwright',
    'better-sqlite3',
    'pino-pretty',
  ],
}

export default config
