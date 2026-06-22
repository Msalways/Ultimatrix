import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { Logger } from '../utils/logger.js'
import { GraphStore } from '../graph/store.js'
import { getGlobalGraphStore } from '../graph/store.js'
import { FindingNode } from '../graph/schema.js'

export interface AppModel {
  target: string
  techStack: string[]
  authDetected: boolean
  authType?: string
  endpoints: {
    url: string
    method: string
    params: Record<string, string>
    headers: Record<string, string>
  }[]
  forms: {
    url: string
    method: string
    fields: Array<{
      name: string
      type: string
      required: boolean
    }>
  }[]
  har: {
    log: {
      version: string
      creator: { name: string; version: string }
      entries: Array<{
        startedDateTime: string
        request: {
          method: string
          url: string
          headers: Array<{ name: string; value: string }>
          postData?: { mimeType: string; text: string }
        }
        response: {
          status: number
          statusText: string
          headers: Array<{ name: string; value: string }>
          content: { mimeType: string; text: string; size: number }
        }
      }>
    }
  }
}

export interface Trace {
  id: string
  timestamp: Date
  type: 'attack' | 'discovery' | 'error'
  technique: string
  endpoint: string
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }
  response: {
    status: number
    headers: Record<string, string>
    body: string
    duration: number
  }
  result: 'success' | 'failure' | 'partial'
  finding?: FindingNode
}

export interface ContextWriterConfig {
  scanId: string
}

export class ContextWriter {
  private config: ContextWriterConfig
  private logger: Logger
  private graphStore: GraphStore

  constructor(config: ContextWriterConfig, logger?: Logger) {
    this.config = config
    this.logger = logger || new Logger('ContextWriter')
    this.graphStore = getGlobalGraphStore()
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing context writer for scan', this.config.scanId)
    
    // Ensure context directory exists
    const contextDir = this.getContextPath()
    if (!existsSync(contextDir)) {
      await mkdir(contextDir, { recursive: true })
      this.logger.success(`Created context directory: ${contextDir}`)
    }
  }

  async writeAppModel(appModel: AppModel): Promise<void> {
    const filePath = join(this.getContextPath(), 'app-model.json')
    
    try {
      await this.writeJsonFile(filePath, appModel)
      this.logger.success(`Wrote app model to ${filePath}`)
    } catch (error) {
      this.logger.error(`Failed to write app model:`, error)
      throw error
    }
  }

  async writeFindings(findings: FindingNode[]): Promise<void> {
    const filePath = join(this.getContextPath(), 'findings.json')
    
    try {
      const findingsData = findings.map(finding => ({
        id: finding.id,
        type: finding.type,
        label: finding.label,
        properties: finding.properties,
        createdAt: finding.createdAt,
        updatedAt: finding.updatedAt
      }))
      
      await this.writeJsonFile(filePath, findingsData)
      this.logger.success(`Wrote ${findings.length} findings to ${filePath}`)
    } catch (error) {
      this.logger.error(`Failed to write findings:`, error)
      throw error
    }
  }

  async writeTraces(traces: Trace[]): Promise<void> {
    const filePath = join(this.getContextPath(), 'traces.json')
    
    try {
      const tracesData = traces.map(trace => ({
        ...trace,
        timestamp: trace.timestamp.toISOString()
      }))
      
      await this.writeJsonFile(filePath, tracesData)
      this.logger.success(`Wrote ${traces.length} traces to ${filePath}`)
    } catch (error) {
      this.logger.error(`Failed to write traces:`, error)
      throw error
    }
  }

  async saveGraphStore(): Promise<void> {
    const filePath = join(this.getContextPath(), 'graph.json')
    
    try {
      // Save current graph store state
      await this.graphStore.save(filePath)
      this.logger.success(`Saved graph store to ${filePath}`)
    } catch (error) {
      this.logger.error(`Failed to save graph store:`, error)
      throw error
    }
  }

  async writeContextFiles(
    appModel: AppModel,
    findings: FindingNode[],
    traces: Trace[]
  ): Promise<void> {
    this.logger.info('Writing all context files')
    
    await Promise.all([
      this.writeAppModel(appModel),
      this.writeFindings(findings),
      this.writeTraces(traces),
      this.saveGraphStore()
    ])
    
    this.logger.success('All context files written successfully')
  }

  getContextPath(): string {
    const scanManagerPath = import.meta.url.includes('file:') 
      ? new URL(import.meta.url).pathname 
      : process.cwd()
    
    // Assuming scan-manager.ts is in the same directory as this file
    const scanManagerModule = await import('../scan-manager.js')
    const scanManager = new scanManagerModule.ScanManager({ 
      scansDir: join(scanManagerModule.dirname(scanManagerPath), 'scans') 
    })
    
    return scanManager.getContextPath(this.config.scanId)
  }

  private async writeJsonFile(filePath: string, data: any): Promise<void> {
    await writeFile(filePath, JSON.stringify(data, null, 2))
  }
}