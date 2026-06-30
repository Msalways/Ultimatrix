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
  private readonly persistPath: string

  constructor(maxEntries = 1000, persistPath?: string) {
    this.maxEntries = maxEntries
    this.persistPath = persistPath || resolve('output', 'oast-callbacks.json')
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
    const dir = resolve(this.persistPath, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(this.persistPath, JSON.stringify(this.callbacks, null, 2), 'utf-8')
  }

  async load(): Promise<void> {
    if (!existsSync(this.persistPath)) return
    try {
      const raw = await readFile(this.persistPath, 'utf-8')
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

export function setGlobalOastStore(store: OastStore): void {
  _globalOastStore = store
}

export { OAST_PERSIST_PATH }