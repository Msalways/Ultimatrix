import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { GraphStore, setGlobalGraphStore } from './graph/store'
import { OastStore, setGlobalOastStore } from './oast/store'
import { log } from './utils/logger'

function slugify(target: string): string {
  return target
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

export class WorkspaceManager {
  private baseDir: string
  private currentTarget: string | null = null
  private graphStore: GraphStore | null = null
  private oastStore: OastStore | null = null

  constructor(baseDir?: string) {
    this.baseDir = baseDir || resolve(process.cwd(), 'output')
  }

  getTargetDir(target: string): string {
    return resolve(this.baseDir, slugify(target))
  }

  getScansDir(target: string): string {
    return resolve(this.getTargetDir(target), 'scans')
  }

  async ensureTarget(target: string): Promise<void> {
    const dir = this.getTargetDir(target)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    const scansDir = this.getScansDir(target)
    if (!existsSync(scansDir)) {
      await mkdir(scansDir, { recursive: true })
    }
  }

  async switchTarget(target: string): Promise<{ graphStore: GraphStore; oastStore: OastStore }> {
    if (this.currentTarget === target && this.graphStore && this.oastStore) {
      return { graphStore: this.graphStore, oastStore: this.oastStore }
    }

    await this.ensureTarget(target)

    const graphPath = resolve(this.getTargetDir(target), 'graph.json')
    const oastPath = resolve(this.getTargetDir(target), 'oast-callbacks.json')

    this.graphStore = new GraphStore(graphPath)
    this.oastStore = new OastStore(1000, oastPath)
    this.currentTarget = target

    await this.graphStore.load()
    await this.oastStore.load()

    setGlobalGraphStore(this.graphStore)
    setGlobalOastStore(this.oastStore)

    log.info(`Workspace: ${this.getTargetDir(target)}`)

    return { graphStore: this.graphStore, oastStore: this.oastStore }
  }

  async createScan(target: string, scanId: string): Promise<string> {
    const scansDir = this.getScansDir(target)
    const scanDir = resolve(scansDir, scanId)
    if (!existsSync(scanDir)) {
      await mkdir(scanDir, { recursive: true })
    }
    return scanDir
  }

  getGraphStore(): GraphStore | null {
    return this.graphStore
  }

  getOastStore(): OastStore | null {
    return this.oastStore
  }

  getCurrentTarget(): string | null {
    return this.currentTarget
  }
}

let _globalWorkspace: WorkspaceManager | null = null

export function getGlobalWorkspace(): WorkspaceManager {
  if (!_globalWorkspace) {
    _globalWorkspace = new WorkspaceManager()
  }
  return _globalWorkspace
}
