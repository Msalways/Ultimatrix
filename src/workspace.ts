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
  private currentTenant: string | null = null
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

  /**
   * Tenant-isolated state root: <baseDir>/tenants/<tenantId>/.
   * Logical isolation — each tenant gets its own graph/oast/log/evidence namespace.
   * (NOT OS-level container sandboxing; see dispatchSlices/WorkerPool for usage.)
   */
  getTenantDir(tenantId: string): string {
    return resolve(this.baseDir, 'tenants', slugify(tenantId))
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

  /**
   * Scope the workspace's state namespace under an isolated tenant.
   * Mirrors switchTarget but writes graph/oast/log/evidence under
   * <baseDir>/tenants/<tenantId>/ — logical multi-tenant isolation that
   * keeps each tenant's state separate from the per-target and global stores.
   *
   * OS-level container sandboxing is intentionally OUT OF SCOPE; this provides
   * logical (filesystem + in-memory store) isolation only.
   */
  async switchTenant(tenantId: string): Promise<{ graphStore: GraphStore; oastStore: OastStore }> {
    if (this.currentTenant === tenantId && this.graphStore && this.oastStore) {
      return { graphStore: this.graphStore, oastStore: this.oastStore }
    }

    const tenantDir = this.getTenantDir(tenantId)
    if (!existsSync(tenantDir)) {
      await mkdir(tenantDir, { recursive: true })
    }

    const graphPath = resolve(tenantDir, 'graph.json')
    const oastPath = resolve(tenantDir, 'oast-callbacks.json')

    this.graphStore = new GraphStore(graphPath)
    this.oastStore = new OastStore(1000, oastPath)
    this.currentTenant = tenantId

    await this.graphStore.load()
    await this.oastStore.load()

    setGlobalGraphStore(this.graphStore)
    setGlobalOastStore(this.oastStore)

    log.info(`Workspace tenant: ${tenantDir}`)

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

  /**
   * Global, cross-engagement storage dir — SEPARATE from per-target dirs
   * (which are slugified under baseDir and fully reset per target).
   * The cross-engagement memory persists anonymized priors across engagements
   * and must never contain per-target identity.
   */
  getGlobalMemoryDir(): string {
    return resolve(this.baseDir, 'global')
  }

  getCrossEngagementPath(): string {
    return resolve(this.getGlobalMemoryDir(), 'cross-engagement-memory.json')
  }

  getCurrentTenant(): string | null {
    return this.currentTenant
  }
}

let _globalWorkspace: WorkspaceManager | null = null

export function getGlobalWorkspace(): WorkspaceManager {
  if (!_globalWorkspace) {
    _globalWorkspace = new WorkspaceManager()
  }
  return _globalWorkspace
}
