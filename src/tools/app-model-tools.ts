import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'


function appModelPath(): string {
  return resolve(process.cwd(), 'output', 'app-model.json')
}

type AppModel = Record<string, unknown>

async function ensureDir(): Promise<void> {
  const dir = resolve('output')
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
}

async function readModel(): Promise<AppModel> {
  await ensureDir()
  if (!existsSync(appModelPath())) {
    await writeFile(appModelPath(), '{}', 'utf-8')
    return {}
  }
  try {
    const raw = await readFile(appModelPath(), 'utf-8')
    return JSON.parse(raw) as AppModel
  } catch {
    return {}
  }
}

async function writeModel(model: AppModel): Promise<void> {
  await ensureDir()
  await writeFile(appModelPath(), JSON.stringify(model, null, 2), 'utf-8')
}

export const readAppModelSection = createTool({
  id: 'readAppModelSection',
  description: 'Read a section from the application model JSON file.',
  inputSchema: z.object({
    section: z.string(),
  }),
  execute: async ({ section }) => {
    try {
      const model = await readModel()
      const data = model[section]
      return { ok: true, value: data !== undefined ? data : null }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const writeAppModelSection = createTool({
  id: 'writeAppModelSection',
  description: 'Write or append data to a section of the application model JSON file.',
  inputSchema: z.object({
    section: z.string(),
    data: z.any(),
    append: z.boolean().optional().default(false),
  }),
  execute: async ({ section, data, append }) => {
    try {
      const model = await readModel()
      if (append) {
        const existing = model[section]
        if (Array.isArray(existing) && Array.isArray(data)) {
          model[section] = [...existing, ...data] as unknown
        } else if (typeof existing === 'object' && existing !== null) {
          model[section] = { ...(existing as Record<string, unknown>), ...(typeof data === 'object' && data !== null ? data : {}) } as unknown
        } else {
          model[section] = data as unknown
        }
      } else {
        model[section] = data as unknown
      }
      await writeModel(model)
      const sectionData = model[section]
      const itemCount = Array.isArray(sectionData)
        ? sectionData.length
        : typeof sectionData === 'object' && sectionData !== null
          ? Object.keys(sectionData).length
          : 1
      return { ok: true, value: { written: true, section, itemCount } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
