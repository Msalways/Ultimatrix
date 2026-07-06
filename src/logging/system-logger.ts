import { log } from '../utils/logger'

export interface SystemMetrics {
  timestamp: number
  compressionStats: {
    totalCompressions: number
    totalTokensSaved: number
    averageCompressionRatio: number
    fallbackCount: number
    errorCount: number
  }
  dialogStats: {
    totalDialogs: number
    successfulDismissals: number
    failedDismissals: number
    alertCount: number
    confirmCount: number
    promptCount: number
  }
  graphStats: {
    totalSaves: number
    successfulSaves: number
    failedSaves: number
    averageSaveTime: number
  }
  errorStats: {
    truncationErrors: number
    compressionErrors: number
    dialogErrors: number
    graphErrors: number
  }
}

export class SystemLogger {
  private metrics: SystemMetrics
  private startTime: number

  constructor() {
    this.startTime = Date.now()
    this.metrics = this.initializeMetrics()
  }

  private initializeMetrics(): SystemMetrics {
    return {
      timestamp: Date.now(),
      compressionStats: {
        totalCompressions: 0,
        totalTokensSaved: 0,
        averageCompressionRatio: 0,
        fallbackCount: 0,
        errorCount: 0,
      },
      dialogStats: {
        totalDialogs: 0,
        successfulDismissals: 0,
        failedDismissals: 0,
        alertCount: 0,
        confirmCount: 0,
        promptCount: 0,
      },
      graphStats: {
        totalSaves: 0,
        successfulSaves: 0,
        failedSaves: 0,
        averageSaveTime: 0,
      },
      errorStats: {
        truncationErrors: 0,
        compressionErrors: 0,
        dialogErrors: 0,
        graphErrors: 0,
      },
    }
  }

  // Compression logging
  logCompression(originalSize: number, compressedSize: number, tokensSaved: number, wasCompressed: boolean, error?: string) {
    this.metrics.compressionStats.totalCompressions++
    this.metrics.compressionStats.totalTokensSaved += tokensSaved
    
    if (wasCompressed) {
      const ratio = compressedSize / originalSize
      this.metrics.compressionStats.averageCompressionRatio = 
        (this.metrics.compressionStats.averageCompressionRatio + ratio) / 2
    }

    if (error) {
      this.metrics.compressionStats.errorCount++
      log.error(`[compression] Error: ${error}`)
    }

    log.dim(`[compression] ${originalSize} → ${compressedSize} chars, saved ${tokensSaved} tokens, ${wasCompressed ? 'compressed' : 'original'}${error ? ` (error: ${error})` : ''}`)
  }

  logCompressionFallback(originalSize: number, compressedSize: number, reason: string) {
    this.metrics.compressionStats.fallbackCount++
    log.dim(`[compression] Fallback used: ${reason} (${originalSize} → ${compressedSize} chars)`)
  }

  // Dialog logging
  logDialogDetected(type: string, url: string) {
    this.metrics.dialogStats.totalDialogs++
    this.metrics.dialogStats[`${type}Count` as keyof typeof this.metrics.dialogStats]++
    
    log.info(`[dialog] Detected ${type} dialog on ${url}`)
  }

  logDialogDismissal(success: boolean, error?: string) {
    if (success) {
      this.metrics.dialogStats.successfulDismissals++
      log.dim(`[dialog] Dismissed successfully`)
    } else {
      this.metrics.dialogStats.failedDismissals++
      this.metrics.errorStats.dialogErrors++
      log.error(`[dialog] Dismiss failed: ${error || 'Unknown error'}`)
    }
  }

  // Graph logging
  logGraphSave(start: number, success: boolean, error?: string) {
    const duration = Date.now() - start
    this.metrics.graphStats.totalSaves++
    
    if (success) {
      this.metrics.graphStats.successfulSaves++
      this.metrics.graphStats.averageSaveTime = 
        (this.metrics.graphStats.averageSaveTime + duration) / 2
      log.dim(`[graph] Saved successfully in ${duration}ms`)
    } else {
      this.metrics.graphStats.failedSaves++
      this.metrics.errorStats.graphErrors++
      log.error(`[graph] Save failed: ${error || 'Unknown error'} after ${duration}ms`)
    }
  }

  // Error logging
  logError(type: 'truncation' | 'compression' | 'dialog' | 'graph', error: string, context?: any) {
    this.metrics.errorStats[`${type}Errors` as keyof typeof this.metrics.errorStats]++
    
    const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : ''
    log.error(`[${type}] Error: ${error}${contextStr}`)
  }

  // Generate summary report
  generateSummary(): string {
    const uptime = Date.now() - this.startTime
    const uptimeStr = `${Math.round(uptime / 1000)}s`
    
    const compression = this.metrics.compressionStats
    const dialog = this.metrics.dialogStats
    const graph = this.metrics.graphStats
    const errors = this.metrics.errorStats

    return `
System Summary (${uptimeStr}):
├─ Compression: ${compression.totalCompressions} total, ${compression.totalTokensSaved} tokens saved
│  ├─ Average ratio: ${(compression.averageCompressionRatio * 100).toFixed(1)}%
│  ├─ Fallbacks: ${compression.fallbackCount}
│  └─ Errors: ${compression.errorCount}
├─ Dialogs: ${dialog.totalDialogs} total
│  ├─ Alerts: ${dialog.alertCount}, Confirms: ${dialog.confirmCount}, Prompts: ${dialog.promptCount}
│  ├─ Success: ${dialog.successfulDismissals}, Failed: ${dialog.failedDismissals}
│  └─ Rate: ${dialog.totalDialogs > 0 ? ((dialog.successfulDismissals / dialog.totalDialogs) * 100).toFixed(1) : 0}%
├─ Graph: ${graph.totalSaves} total, ${graph.successfulSaves}/${graph.failedSaves} success
│  └─ Avg time: ${graph.averageSaveTime.toFixed(0)}ms
└─ Errors: ${errors.truncationErrors + errors.compressionErrors + errors.dialogErrors + errors.graphErrors} total
   ├─ Truncation: ${errors.truncationErrors}
   ├─ Compression: ${errors.compressionErrors}
   ├─ Dialog: ${errors.dialogErrors}
   └─ Graph: ${errors.graphErrors}
`.trim()
  }

  // Get current metrics
  getMetrics(): SystemMetrics {
    return { ...this.metrics }
  }
}

// Global instance
export const systemLogger = new SystemLogger()