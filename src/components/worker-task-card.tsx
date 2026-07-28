'use client'

import type { SwarmWorker, ToolCallEvent } from '@/stores/app-store'

function StatusBadge({ status }: { status: SwarmWorker['status'] }) {
  const config = {
    queued: { label: 'Queued', cls: 'bg-gray-600/30 text-gray-400 border-gray-600/30' },
    running: { label: 'Running', cls: 'bg-green-500/20 text-green-400 border-green-500/30 animate-pulse' },
    completed: { label: 'Completed', cls: 'bg-green-600/20 text-green-300 border-green-600/30' },
    error: { label: 'Error', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
    timeout: { label: 'Timeout', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    killed: { label: 'Killed', cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  }
  const c = config[status] ?? config.queued
  return (
    <span className={`px-2 py-0.5 text-[10px] font-mono rounded border ${c.cls}`}>
      {c.label}
    </span>
  )
}

function ToolCallRow({ tc }: { tc: ToolCallEvent }) {
  const dur = tc.durationMs ? `${tc.durationMs}ms` : '...'
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono py-0.5">
      <span className="text-green-400/60">→</span>
      <span className="text-gray-300 truncate max-w-[200px]">{tc.toolName}</span>
      <span className={`ml-auto ${tc.ok ? 'text-green-500/60' : 'text-red-400/60'}`}>
        {tc.ok ? '✓' : '✗'} {dur}
      </span>
    </div>
  )
}

export function WorkerTaskCard({ worker }: { worker: SwarmWorker }) {
  const elapsed = worker.durationMs
    ? `${(worker.durationMs / 1000).toFixed(1)}s`
    : worker.status === 'running'
      ? `${((Date.now() - worker.startedAt) / 1000).toFixed(1)}s`
      : ''

  return (
    <div className="panel-holographic rounded-lg p-3 transition-all hover:border-green-400/20">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-green-400 text-sm">⬡</span>
        <span className="text-xs font-medium text-green-100 truncate flex-1">
          {worker.name}
        </span>
        <StatusBadge status={worker.status} />
      </div>

      {/* Task */}
      <div className="text-[11px] text-gray-400 mb-2 line-clamp-2">
        {worker.task}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500 mb-2">
        <span>skill: {worker.skillId}</span>
        {elapsed && <span className="ml-auto">{elapsed}</span>}
      </div>

      {/* Tool calls */}
      {worker.toolCalls.length > 0 && (
        <div className="border-t border-green-400/10 pt-2 mt-2 space-y-0 max-h-[120px] overflow-y-auto">
          {worker.toolCalls.map((tc, i) => (
            <ToolCallRow key={i} tc={tc} />
          ))}
        </div>
      )}

      {/* Result/error */}
      {worker.error && (
        <div className="mt-2 text-[10px] text-red-400/80 font-mono truncate">
          {worker.error}
        </div>
      )}
      {worker.status === 'completed' && worker.graphDiff && (
        <div className="mt-2 text-[10px] text-green-500/60 font-mono">
          +{worker.graphDiff.nodesAdded} nodes, +{worker.graphDiff.findingsAdded} findings
        </div>
      )}
    </div>
  )
}
