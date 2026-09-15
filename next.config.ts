import type { NextConfig } from 'next'

const config: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
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
  async rewrites() {
    return [
      { source: '/favicon.ico', destination: '/favicon.svg' },
    ]
  },
}

export default config
