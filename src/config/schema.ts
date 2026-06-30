import { z } from 'zod'

export const UltimatrixConfigSchema = z.object({
  target: z.string().url(),
  credentials: z.record(z.string(), z.object({
    email: z.string().email(),
    password: z.string().min(1),
  })).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  outputDir: z.string().optional(),
  skillsDir: z.string().optional(),
  browserOptions: z.object({
    headless: z.boolean().optional(),
    viewport: z.object({
      width: z.number().min(100).max(4000),
      height: z.number().min(100).max(4000),
    }).optional(),
  }).optional(),
})

export type ValidatedConfig = z.infer<typeof UltimatrixConfigSchema>

export function validateConfig(config: unknown): ValidatedConfig {
  const result = UltimatrixConfigSchema.safeParse(config)
  if (!result.success) {
    throw new Error(`Invalid config: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`)
  }
  return result.data
}

export function loadConfig(path: string): ValidatedConfig {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { load } = require('js-yaml') as typeof import('js-yaml')

  const content = readFileSync(path, 'utf-8')
  const config = load(content)
  return validateConfig(config)
}
