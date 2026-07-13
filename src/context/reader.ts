/**
 * @deprecated Use the graph store (`src/graph/store.ts`) for reading
 * application state instead. This module is retained solely for backward
 * compatibility with legacy v6/v7 scan workflows.
 */
import { readFile } from 'fs/promises'
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

export interface FindingData {
  id: string
  type: string
  label: string
  properties: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Trace {
  id: string
  timestamp: string
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

export interface ContextData {
  appModel: AppModel | null
  findings: FindingData[]
  traces: Trace[]
}

export interface ContextReaderConfig {
  scanId: string
}

export class ContextReader {
  private config: ContextReaderConfig
  private logger: Logger
  private graphStore: GraphStore

  constructor(config: ContextReaderConfig, logger?: Logger) {
    this.config = config
    this.logger = logger || new Logger('ContextReader')
    this.graphStore = getGlobalGraphStore()
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing context reader for scan', this.config.scanId)
    
    // Load graph store
    const graphPath = join(this.getContextPath(), 'graph.json')
    if (existsSync(graphPath)) {
      await this.graphStore.load(graphPath)
      this.logger.success(`Loaded graph store from ${graphPath}`)
    } else {
      this.logger.warn(`Graph file not found at ${graphPath}`)
    }
  }

  async readAppModel(): Promise<AppModel | null> {
    const filePath = join(this.getContextPath(), 'app-model.json')
    
    if (!existsSync(filePath)) {
      this.logger.warn(`App model file not found at ${filePath}`)
      return null
    }

    try {
      const data = await this.readJsonFile<AppModel>(filePath)
      this.logger.success(`Read app model from ${filePath}`)
      return data
    } catch (error) {
      this.logger.error(`Failed to read app model:`, error)
      return null
    }
  }

  async readFindings(): Promise<FindingData[]> {
    const filePath = join(this.getContextPath(), 'findings.json')
    
    if (!existsSync(filePath)) {
      this.logger.warn(`Findings file not found at ${filePath}`)
      return []
    }

    try {
      const data = await this.readJsonFile<FindingData[]>(filePath)
      this.logger.success(`Read ${data.length} findings from ${filePath}`)
      return data
    } catch (error) {
      this.logger.error(`Failed to read findings:`, error)
      return []
    }
  }

  async readTraces(): Promise<Trace[]> {
    const filePath = join(this.getContextPath(), 'traces.json')
    
    if (!existsSync(filePath)) {
      this.logger.warn(`Traces file not found at ${filePath}`)
      return []
    }

    try {
      const data = await this.readJsonFile<Trace[]>(filePath)
      const tracesWithDates = data.map(trace => ({
        ...trace,
        timestamp: new Date(trace.timestamp)
      }))
      this.logger.success(`Read ${tracesWithDates.length} traces from ${filePath}`)
      return tracesWithDates
    } catch (error) {
      this.logger.error(`Failed to read traces:`, error)
      return []
    }
  }

  async readContext(): Promise<ContextData> {
    this.logger.info('Reading all context files')
    
    const [appModel, findings, traces] = await Promise.all([
      this.readAppModel(),
      this.readFindings(),
      this.readTraces()
    ])

    const contextData: ContextData = {
      appModel,
      findings,
      traces
    }

    this.logger.success(`Read context: appModel=${appModel ? 'present' : 'missing'}, findings=${findings.length}, traces=${traces.length}`)
    return contextData
  }

  async loadGraphStore(): Promise<void> {
    const graphPath = join(this.getContextPath(), 'graph.json')
    
    if (existsSync(graphPath)) {
      await this.graphStore.load(graphPath)
      this.logger.success(`Loaded graph store from ${graphPath}`)
    } else {
      this.logger.warn(`Graph file not found at ${graphPath}`)
    }
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

  private async readJsonFile<T>(filePath: string): Promise<T> {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  }
}