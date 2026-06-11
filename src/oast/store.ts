import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface OastCallback {
  id: string
  url: string
  method: string
  headers: Record<string, string>
  body: string
  query: Record<string, string>
  timestamp: number
  sourceIp?: string
}

const OAST_PERSIST_PATH = resolve('output', 'oast-callbacks.json')

export class OastStore {
  private callbacks: OastCallback[] = []
  private readonly maxEntries: number

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries
  }

  add(callback: OastCallback): void {
    this.callbacks.push(callback)
    if (this.callbacks.length > this.maxEntries) {
      this.callbacks = this.callbacks.slice(-this.maxEntries)
    }
  }

  getAll(): OastCallback[] {
    return this.callbacks
  }

  getById(id: string): OastCallback | undefined {
    return this.callbacks.find(c => c.id === id)
  }

  getByUrl(urlPattern: string): OastCallback[] {
    return this.callbacks.filter(c => c.url.includes(urlPattern))
  }

  clear(): void {
    this.callbacks = []
  }

  count(): number {
    return this.callbacks.length
  }

  async save(): Promise<void> {
    await mkdir(resolve('output'), { recursive: true })
    await writeFile(OAST_PERSIST_PATH, JSON.stringify(this.callbacks, null, 2), 'utf-8')
  }

  async load(): Promise<void> {
    if (!existsSync(OAST_PERSIST_PATH)) return
    try {
      const raw = await readFile(OAST_PERSIST_PATH, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        this.callbacks = data.slice(-this.maxEntries)
      }
    } catch {
      // corrupt file — start fresh
    }
  }
}

let _globalOastStore: OastStore | null = null

export function getGlobalOastStore(): OastStore {
  if (!_globalOastStore) {
    _globalOastStore = new OastStore()
  }
  return _globalOastStore
}

export { OAST_PERSIST_PATH }