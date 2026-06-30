import { mkdir, existsSync, stat } from 'fs/promises'
import { join } from 'path'
import { Logger } from './utils/logger.js'

export interface ScanManagerConfig {
  scansDir: string
}

export interface ScanInfo {
  id: string
  dir: string
  createdAt: Date
  status: 'created' | 'running' | 'completed' | 'failed'
  target?: string
}

export class ScanManager {
  private config: ScanManagerConfig
  private logger: Logger

  constructor(config: ScanManagerConfig, logger?: Logger) {
    this.config = config
    this.logger = logger || new Logger('ScanManager')
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing scan manager')
    
    // Create scans directory if it doesn't exist
    if (!existsSync(this.config.scansDir)) {
      await mkdir(this.config.scansDir, { recursive: true })
      this.logger.success(`Created scans directory: ${this.config.scansDir}`)
    }
  }

  async createScan(scanId: string, target?: string): Promise<ScanInfo> {
    const scanDir = join(this.config.scansDir, scanId)
    const contextDir = join(scanDir, 'context')
    
    // Create scan directory structure
    await mkdir(scanDir, { recursive: true })
    await mkdir(contextDir, { recursive: true })
    
    const scanInfo: ScanInfo = {
      id: scanId,
      dir: scanDir,
      createdAt: new Date(),
      status: 'created',
      target
    }

    // Write initial scan.json
    const scanJson = {
      id: scanId,
      target,
      createdAt: scanInfo.createdAt.toISOString(),
      status: scanInfo.status,
      cycles: 0,
      totalFindings: 0,
      chainsDetected: 0
    }

    await this.writeJsonFile(join(scanDir, 'scan.json'), scanJson)
    
    this.logger.success(`Created scan ${scanId} at ${scanDir}`)
    return scanInfo
  }

  async getScan(scanId: string): Promise<ScanInfo | null> {
    const scanDir = join(this.config.scansDir, scanId)
    
    if (!existsSync(scanDir)) {
      return null
    }

    try {
      const scanJson = await this.readJsonFile(join(scanDir, 'scan.json'))
      return {
        id: scanJson.id,
        dir: scanDir,
        createdAt: new Date(scanJson.createdAt),
        status: scanJson.status,
        target: scanJson.target
      }
    } catch (error) {
      this.logger.error(`Failed to read scan info for ${scanId}:`, error)
      return null
    }
  }

  async updateScanStatus(scanId: string, status: ScanInfo['status']): Promise<void> {
    const scanInfo = await this.getScan(scanId)
    if (!scanInfo) {
      throw new Error(`Scan ${scanId} not found`)
    }

    const scanJson = {
      ...await this.readJsonFile(join(scanInfo.dir, 'scan.json')),
      status,
      updatedAt: new Date().toISOString()
    }

    await this.writeJsonFile(join(scanInfo.dir, 'scan.json'), scanJson)
    this.logger.info(`Updated scan ${scanId} status to ${status}`)
  }

  async updateScanMetrics(scanId: string, metrics: Partial<{
    cycles: number
    totalFindings: number
    chainsDetected: number
  }>): Promise<void> {
    const scanInfo = await this.getScan(scanId)
    if (!scanInfo) {
      throw new Error(`Scan ${scanId} not found`)
    }

    const scanJson = {
      ...await this.readJsonFile(join(scanInfo.dir, 'scan.json')),
      ...metrics,
      updatedAt: new Date().toISOString()
    }

    await this.writeJsonFile(join(scanInfo.dir, 'scan.json'), scanJson)
  }

  async listScans(): Promise<ScanInfo[]> {
    const scans: ScanInfo[] = []
    
    try {
      const entries = await readdir(this.config.scansDir)
      
      for (const entry of entries) {
        const scanDir = join(this.config.scansDir, entry)
        const stats = await stat(scanDir)
        
        if (stats.isDirectory()) {
          const scanInfo = await this.getScan(entry)
          if (scanInfo) {
            scans.push(scanInfo)
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to list scans:', error)
    }

    return scans.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async deleteScan(scanId: string): Promise<void> {
    const scanInfo = await this.getScan(scanId)
    if (!scanInfo) {
      throw new Error(`Scan ${scanId} not found`)
    }

    const { rm } = await import('fs/promises')
    await rm(scanInfo.dir, { recursive: true, force: true })
    this.logger.success(`Deleted scan ${scanId}`)
  }

  getContextPath(scanId: string): string {
    return join(this.config.scansDir, scanId, 'context')
  }

  getScanPath(scanId: string): string {
    return join(this.config.scansDir, scanId)
  }

  private async writeJsonFile(filePath: string, data: any): Promise<void> {
    const { writeFile } = await import('fs/promises')
    await writeFile(filePath, JSON.stringify(data, null, 2))
  }

  private async readJsonFile(filePath: string): Promise<any> {
    const { readFile } = await import('fs/promises')
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content)
  }
}

// Helper function to read directory
async function readdir(path: string): Promise<string[]> {
  const { readdir } = await import('fs/promises')
  return readdir(path)
}