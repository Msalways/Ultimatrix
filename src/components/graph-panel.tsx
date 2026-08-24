'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Activity, AlertTriangle, Cpu, Maximize2, Minimize2, Network, RefreshCw, ShieldCheck, Wrench, X, ExternalLink, ChevronRight, type LucideIcon } from 'lucide-react'
import { useSessionStore } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { useResourceStore } from '@/stores/resource-store'
import { cn } from '@/lib/utils'
import { GraphSkeleton, FindingsSkeleton, WorkersSkeleton, SkillsSkeleton } from './skeletons'
import { dataFetcher, type GraphData, type FindingData, type WorkerData, type SkillData, type GraphNode, type GraphEdge } from '@/services/data-fetcher'

interface RailEvent {
  _event?: string
  type?: string
  timestamp?: number
  workerName?: string
  workerId?: string
  toolName?: string
  nodeType?: string
  label?: string
  message?: string
  actionType?: string
  selector?: string
  url?: string
}

type RailTab = 'graph' | 'findings' | 'workers' | 'skills' | 'activity'

const RAIL_TABS: Array<{ id: RailTab; label: string; icon: LucideIcon }> = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'findings', label: 'Findings', icon: AlertTriangle },
  { id: 'workers', label: 'Workers', icon: Cpu },
  { id: 'skills', label: 'Skills', icon: Wrench },
  { id: 'activity', label: 'Activity', icon: Activity },
]

const NODE_COLORS: Record<string, string> = {
  Page: '#3b82f6',
  Endpoint: '#8b5cf6',
  Finding: '#ef4444',
  Action: '#22c55e',
  Input: '#f59e0b',
  Fact: '#6b7280',
  AuthFlow: '#ec4899',
  RBACRole: '#f97316',
  Attack: '#dc2626',
  Hypothesis: '#a78bfa',
  Reflexion: '#14b8a6',
  Intent: '#06b6d4',
  ExploitProof: '#f43f5e',
  ThreatModel: '#e11d48',
  OutcomeFeedback: '#84cc16',
  CouncilDebate: '#c084fc',
  RenderedElement: '#2dd4bf',
  HeaderSemantic: '#64748b',
  AuthScheme: '#d946ef',
}

function getNodeColor(type: string): string {
  return NODE_COLORS[type] || '#6b7280'
}

export function GraphPanel() {
  const activeTarget = useSessionStore((s) => s.activeTarget)
  const inspectorOpen = useUIStore((s) => s.inspectorOpen)
  const closeInspector = useUIStore((s) => s.closeInspector)
  const graphState = useResourceStore((s) => s.resources.graph.state)
  const graphError = useResourceStore((s) => s.resources.graph.error)
  const hasGraphData = useResourceStore((s) => s.hasData('graph'))
  const [data, setData] = useState<GraphData | null>(null)
  const [findings, setFindings] = useState<FindingData[]>([])
  const [workers, setWorkers] = useState<WorkerData[]>([])
  const [skills, setSkills] = useState<SkillData[]>([])
  const [events, setEvents] = useState<RailEvent[]>([])
  const [activeTab, setActiveTab] = useState<RailTab>('graph')
  const [expanded, setExpanded] = useState(false)

  const loadAll = useCallback(async (target: string) => {
    const [graphResult, workersResult, skillsResult] = await Promise.all([
      dataFetcher.loadGraphData(target),
      dataFetcher.loadWorkers(target),
      dataFetcher.loadSkills(target),
    ])
    setData({ nodes: graphResult.nodes, edges: graphResult.edges })
    setFindings(graphResult.findings)
    setWorkers(workersResult.recent)
    setSkills(skillsResult)
  }, [])

  const refresh = useCallback(() => {
    if (activeTarget) loadAll(activeTarget)
  }, [activeTarget, loadAll])

  useEffect(() => {
    if (!activeTarget) return
    loadAll(activeTarget)
  }, [activeTarget, loadAll])

  useEffect(() => {
    const unsubs = [
      dataFetcher.onSSE('graph:', refresh, activeTarget),
      dataFetcher.onSSE('finding:', refresh, activeTarget),
      dataFetcher.onSSE('worker:', refresh, activeTarget),
      dataFetcher.onSSE('spider:', refresh, activeTarget),
      dataFetcher.onSSE('', (evt) => {
        setEvents((current) => [...current, evt].slice(-120))
      }, activeTarget),
    ]
    return () => unsubs.forEach((u) => u())
  }, [activeTarget, refresh])

  const summary = useGraphSummary(data)
  const runningWorkers = workers.filter((worker) => worker.status === 'running').length
  const isRefreshing = graphState === 'refreshing'
  const isLoading = graphState === 'loading'

  return (
    <>
    {inspectorOpen && (
      <button
        type="button"
        aria-label="Close intelligence workspace"
        className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        onClick={closeInspector}
      />
    )}
    <aside className={cn(
      'fixed inset-y-0 right-0 z-40 flex-col border-l border-zinc-800/80 bg-zinc-950 shadow-2xl shadow-black/50 lg:relative lg:inset-auto lg:z-auto lg:flex lg:shadow-none',
      inspectorOpen ? 'flex' : 'hidden',
      expanded ? 'w-[min(94vw,760px)] lg:w-[min(760px,55vw)]' : 'w-[min(92vw,420px)] lg:w-80 xl:w-96',
    )}>
      <div className="flex h-12 items-center justify-between border-b border-zinc-800/80 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden min-w-16 text-xs font-medium text-zinc-300 sm:inline lg:hidden xl:inline">
            {RAIL_TABS.find((tab) => tab.id === activeTab)?.label}
          </span>
          <div className="flex min-w-0 items-center gap-1">
          {RAIL_TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
                title={tab.label}
                className={cn(
                  'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600',
                  activeTab === tab.id
                    ? 'bg-zinc-900 text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300',
                )}
              >
                <Icon size={12} />
              </button>
            )
          })}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            aria-label="Refresh intelligence rail"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
          >
            <RefreshCw size={12} className={cn((isLoading || isRefreshing) && 'animate-spin')} />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Collapse graph' : 'Expand graph'}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
          >
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={closeInspector}
            aria-label="Close intelligence workspace"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 lg:hidden"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-zinc-950">
        {isRefreshing && hasGraphData && (
          <div className="flex items-center justify-center gap-2 border-b border-zinc-800/50 bg-zinc-900/30 px-3 py-1.5 text-[11px] text-zinc-500">
            <RefreshCw size={10} className="animate-spin" />
            Refreshing…
          </div>
        )}
        {graphError && !hasGraphData && (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <AlertTriangle size={16} className="text-red-400" />
            <span className="text-xs text-red-400">{graphError}</span>
            <button onClick={refresh} className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-300">Retry</button>
          </div>
        )}
        {activeTab === 'graph' && (
          data && data.nodes.length > 0 ? (
            <GraphVisualization data={data} />
          ) : (
            isLoading ? <GraphSkeleton /> : <EmptyRailState label={activeTarget ? 'No graph data yet' : 'Select a target'} />
          )
        )}
        {activeTab === 'findings' && (
          findings.length > 0 || !isLoading ? (
            <FindingsList findings={findings} activeTarget={activeTarget} />
          ) : <FindingsSkeleton />
        )}
        {activeTab === 'workers' && (
          workers.length > 0 || !isLoading ? (
            <WorkersList workers={workers} />
          ) : <WorkersSkeleton />
        )}
        {activeTab === 'skills' && (
          skills.length > 0 || !isLoading ? (
            <SkillsList skills={skills} activeTarget={activeTarget} />
          ) : <SkillsSkeleton />
        )}
        {activeTab === 'activity' && <ActivityList events={events} />}
      </div>

      {activeTab === 'graph' && summary && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-zinc-800/80 px-3 py-3 text-xs">
          <div className="flex justify-between gap-3 text-zinc-400">
            <span>Endpoints</span>
            <span>{summary.endpoints}</span>
          </div>
          <div className="flex justify-between gap-3 text-zinc-400">
            <span>Findings</span>
            <span className={cn(summary.findings > 0 && 'text-red-400')}>{summary.findings}</span>
          </div>
          <div className="flex justify-between gap-3 text-zinc-400">
            <span>Auth Flows</span>
            <span>{summary.authFlows}</span>
          </div>
          <div className="flex justify-between gap-3 text-zinc-400">
            <span>Edges</span>
            <span>{summary.totalEdges}</span>
          </div>
          <div className="col-span-2 flex justify-between gap-3 border-t border-zinc-900 pt-2 text-zinc-500">
            <span>Nodes</span>
            <span>{summary.totalNodes}</span>
          </div>
        </div>
      )}
      {activeTab !== 'graph' && (
        <div className="grid grid-cols-3 gap-2 border-t border-zinc-800/80 px-3 py-3 text-xs text-zinc-500">
          <Metric label="Findings" value={findings.length} hot={findings.length > 0} />
          <Metric label="Workers" value={workers.length} hot={runningWorkers > 0} />
          <Metric label="Skills" value={skills.length} />
          {activeTab === 'activity' && <Metric label="Events" value={events.length} />}
        </div>
      )}
    </aside>
    </>
  )
}

function ActivityList({ events }: { events: RailEvent[] }) {
  if (events.length === 0) return <EmptyRailState label="Waiting for engine events" />

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-1.5">
        {[...events].reverse().map((event, index) => {
          const eventName = event._event ?? event.type ?? 'event'
          return (
            <div key={`${eventName}-${event.timestamp ?? index}-${index}`} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-600" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">{eventName}</span>
                {event.timestamp && <span className="flex-shrink-0 text-[10px] text-zinc-600">{formatEventTime(event.timestamp)}</span>}
              </div>
              <div className="mt-1 truncate text-xs text-zinc-600">
                {event.message ?? event.actionType ?? event.workerName ?? event.toolName ?? event.nodeType ?? event.label ?? event.selector ?? event.url ?? event.workerId ?? 'received'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function EmptyRailState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-zinc-600">
      {label}
    </div>
  )
}

function Metric({ label, value, hot = false }: { label: string; value: number; hot?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase text-zinc-600">{label}</div>
      <div className={cn('mt-1 font-mono text-sm text-zinc-400', hot && 'text-amber-300')}>{value}</div>
    </div>
  )
}

function getFindingField(finding: FindingData, key: string): string {
  const value = finding[key as keyof FindingData] ?? finding.properties?.[key]
  return typeof value === 'string' ? value : ''
}

function FindingsList({ findings, activeTarget }: { findings: FindingData[]; activeTarget: string | null }) {
  if (!activeTarget) return <EmptyRailState label="Select a target" />
  if (findings.length === 0) return <EmptyRailState label="No findings recorded" />

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-2">
        {findings.map((finding, index) => {
          const severity = getFindingField(finding, 'severity') || 'info'
          const title = getFindingField(finding, 'title') || getFindingField(finding, 'technique') || finding.type || 'Finding'
          const endpoint = getFindingField(finding, 'endpoint')
          const description = getFindingField(finding, 'description')
          return (
            <div key={finding.id ?? index} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldCheck size={13} className={cn('flex-shrink-0', severityColor(severity))} />
                <span className={cn('text-[10px] font-semibold uppercase', severityColor(severity))}>{severity}</span>
                <span className="min-w-0 truncate text-xs text-zinc-300">{title}</span>
              </div>
              {endpoint && <div className="mt-2 truncate font-mono text-[11px] text-zinc-500">{endpoint}</div>}
              {description && <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">{description}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WorkersList({ workers }: { workers: WorkerData[] }) {
  if (workers.length === 0) return <EmptyRailState label="No worker activity yet" />

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-2">
        {workers.map((worker, index) => (
          <div key={worker.workerId ?? index} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-1.5 w-1.5 rounded-full', worker.status === 'running' ? 'bg-emerald-400' : worker.status === 'error' ? 'bg-red-400' : 'bg-zinc-600')} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-300">{worker.workerName ?? 'Worker'}</span>
              <span className="flex-shrink-0 text-[10px] uppercase text-zinc-600">{worker.status ?? 'unknown'}</span>
            </div>
            {worker.task && <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">{worker.task}</div>}
            <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-zinc-600">
              {worker.skillId && <span className="truncate">skill: {worker.skillId}</span>}
              {typeof worker.toolCalls === 'number' && <span className="ml-auto">{worker.toolCalls} calls</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SkillsList({ skills, activeTarget }: { skills: SkillData[]; activeTarget: string | null }) {
  if (!activeTarget) return <EmptyRailState label="Select a target" />
  if (skills.length === 0) return <EmptyRailState label="No skills loaded for this target" />

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="space-y-2">
        {skills.map((skill) => (
          <div key={skill.id} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-300">{skill.name}</span>
              <span className="flex-shrink-0 rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{skill.domain}</span>
              {skill.tier && (
                <span className={cn(
                  'flex-shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                  skill.tier === 'powerful' ? 'bg-red-900/30 text-red-400' :
                  skill.tier === 'balanced' ? 'bg-amber-900/30 text-amber-400' :
                  'bg-zinc-800 text-zinc-500',
                )}>{skill.tier}</span>
              )}
              <span className={cn(
                'flex-shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                skill.state === 'loaded' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-zinc-800 text-zinc-600',
              )}>{skill.state === 'loaded' ? 'Loaded' : 'Available'}</span>
            </div>
            {skill.description && <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">{skill.description}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical': return 'text-red-300'
    case 'high': return 'text-orange-300'
    case 'medium': return 'text-amber-300'
    case 'low': return 'text-blue-300'
    default: return 'text-zinc-400'
  }
}

function useGraphSummary(data: GraphData | null) {
  if (!data) return null
  return {
    endpoints: data.nodes.filter((n) => n.type === 'Endpoint').length,
    findings: data.nodes.filter((n) => n.type === 'Finding').length,
    authFlows: data.nodes.filter((n) => n.type === 'AuthFlow').length,
    totalNodes: data.nodes.length,
    totalEdges: data.edges.length,
  }
}

function GraphVisualization({ data }: { data: GraphData }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 300, height: 400 })
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [showLegend, setShowLegend] = useState(true)
  const [showLabels, setShowLabels] = useState(true)

  useEffect(() => {
    if (!svgRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    observer.observe(svgRef.current)
    return () => observer.disconnect()
  }, [])

  const { nodes, edges } = useForceLayout(data, dimensions)

  const connectionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const edge of data.edges) {
      counts[edge.source] = (counts[edge.source] || 0) + 1
      counts[edge.target] = (counts[edge.target] || 0) + 1
    }
    return counts
  }, [data.edges])

  const hoveredEdges = useMemo(() => {
    if (!hoveredNode) return new Set<number>()
    const set = new Set<number>()
    edges.forEach((e, i) => {
      if (e.source === hoveredNode || e.target === hoveredNode) set.add(i)
    })
    return set
  }, [hoveredNode, edges])

  const nodeRadius = useCallback((node: GraphNode) => {
    const connections = connectionCounts[node.id] || 0
    const base = node.type === 'Finding' ? 6 : node.type === 'Endpoint' ? 5 : 4
    return base + Math.min(connections * 0.6, 5)
  }, [connectionCounts])

  const getUniqueNodeTypes = useCallback(() => {
    const types = new Set(data.nodes.map((n) => n.type))
    return Array.from(types).sort()
  }, [data.nodes])

  return (
    <div className="relative h-full w-full">
      <svg ref={svgRef} className="h-full w-full" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="6" markerHeight="4" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#52525b" />
          </marker>
          <marker id="arrowhead-active" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="6" markerHeight="4" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#a1a1aa" />
          </marker>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {edges.map((edge, i) => {
          const source = nodes.find((n) => n.id === edge.source)
          const target = nodes.find((n) => n.id === edge.target)
          if (!source || !target) return null
          const isActive = hoveredEdges.has(i)
          return (
            <line
              key={`e-${i}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={isActive ? '#a1a1aa' : '#3f3f46'}
              strokeWidth={isActive ? 1.5 : 0.8}
              markerEnd={isActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
              style={{ transition: 'stroke 0.15s, stroke-width 0.15s' }}
            />
          )
        })}
        {nodes.map((node) => {
          const r = nodeRadius(node)
          const isHovered = hoveredNode === node.id
          const isSelected = selectedNode?.id === node.id
          const isConnected = hoveredNode ? hoveredEdges.size > 0 && (
            edges.some((e) => (e.source === hoveredNode && e.target === node.id) || (e.target === hoveredNode && e.source === node.id))
          ) : false
          const isDimmed = hoveredNode && !isHovered && !isConnected

          return (
            <g
              key={node.id}
              style={{ transition: 'opacity 0.15s' }}
              opacity={isDimmed ? 0.2 : 1}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => setSelectedNode(isSelected ? null : node)}
              className="cursor-pointer"
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={r + (isHovered ? 3 : 0)}
                fill={getNodeColor(node.type)}
                opacity={isHovered || isSelected ? 1 : 0.8}
                filter={isHovered || isSelected ? 'url(#glow)' : undefined}
                style={{ transition: 'r 0.15s, opacity 0.15s' }}
              />
              {isHovered && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r + 6}
                  fill="none"
                  stroke={getNodeColor(node.type)}
                  strokeWidth={1}
                  opacity={0.3}
                />
              )}
              {(showLabels || isHovered || isSelected || isConnected) && node.label && (
                <text
                  x={node.x}
                  y={node.y + r + 10}
                  textAnchor="middle"
                  className="fill-zinc-400 pointer-events-none select-none"
                  fontSize={isHovered ? 10 : 8}
                  fontWeight={isHovered ? 500 : 400}
                >
                  {node.label.length > 20 ? node.label.slice(0, 20) + '…' : node.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-3 left-3 rounded-lg border border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm px-3 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">Types</span>
            <button onClick={() => setShowLegend(false)} className="text-zinc-700 hover:text-zinc-500">
              <X size={10} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {getUniqueNodeTypes().slice(0, 10).map((type) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getNodeColor(type) }} />
                <span className="text-[9px] text-zinc-500">{type}</span>
              </div>
            ))}
          </div>
          {getUniqueNodeTypes().length > 10 && (
            <div className="text-[8px] text-zinc-700 mt-1">+{getUniqueNodeTypes().length - 10} more</div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          onClick={() => setShowLabels(!showLabels)}
          className={cn(
            'rounded-md border px-2 py-1 text-[10px] font-medium transition-all',
            showLabels
              ? 'border-zinc-700 bg-zinc-800 text-zinc-300'
              : 'border-zinc-800 bg-zinc-900/80 text-zinc-600 hover:text-zinc-400',
          )}
        >
          Labels
        </button>
        {!showLegend && (
          <button
            onClick={() => setShowLegend(true)}
            className="rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[10px] font-medium text-zinc-600 hover:text-zinc-400 transition-all"
          >
            Legend
          </button>
        )}
      </div>

      {/* Hover tooltip */}
      {hoveredNode && !selectedNode && (() => {
        const node = nodes.find((n) => n.id === hoveredNode)
        if (!node) return null
        const connections = connectionCounts[node.id] || 0
        return (
          <div className="absolute top-3 left-3 rounded-lg border border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm px-3 py-2 max-w-[200px]">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getNodeColor(node.type) }} />
              <span className="text-xs font-medium text-zinc-200 truncate">{node.label || node.id}</span>
            </div>
            <div className="text-[10px] text-zinc-500">
              {node.type} · {connections} connection{connections !== 1 ? 's' : ''}
            </div>
          </div>
        )
      })()}

      {/* Detail panel on click */}
      {selectedNode && (
        <div className="absolute inset-y-0 right-0 w-56 border-l border-zinc-800/80 bg-zinc-950/95 backdrop-blur-sm overflow-y-auto animate-in slide-in-from-right duration-200">
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: getNodeColor(selectedNode.type) }} />
                <span className="text-xs font-medium text-zinc-200 truncate">{selectedNode.label || selectedNode.id}</span>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-zinc-600 hover:text-zinc-400 shrink-0">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-2">
              <DetailRow label="Type" value={selectedNode.type} />
              <DetailRow label="ID" value={selectedNode.id} mono />
              {connectionCounts[selectedNode.id] > 0 && (
                <DetailRow label="Connections" value={String(connectionCounts[selectedNode.id])} />
              )}
              {selectedNode.properties && Object.entries(selectedNode.properties).slice(0, 8).map(([key, val]) => (
                <DetailRow key={key} label={key} value={typeof val === 'string' ? val : JSON.stringify(val)} mono={typeof val === 'string' && val.length < 60} />
              ))}
            </div>

            {/* Connected nodes */}
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 mb-1.5">Connections</div>
              <div className="space-y-1">
                {edges
                  .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                  .slice(0, 10)
                  .map((e, i) => {
                    const otherId = e.source === selectedNode.id ? e.target : e.source
                    const other = nodes.find((n) => n.id === otherId)
                    if (!other) return null
                    const direction = e.source === selectedNode.id ? '→' : '←'
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedNode(other)}
                        className="flex items-center gap-1.5 w-full text-left rounded px-1.5 py-1 hover:bg-zinc-900 transition-colors"
                      >
                        <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: getNodeColor(other.type) }} />
                        <span className="text-[10px] text-zinc-500 shrink-0">{direction}</span>
                        <span className="text-[10px] text-zinc-400 truncate">{other.label || other.id}</span>
                        <ChevronRight size={8} className="text-zinc-700 shrink-0 ml-auto" />
                      </button>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      <span className={cn('text-[11px] text-zinc-400 break-all', mono && 'font-mono text-[10px]')}>
        {value.length > 100 ? value.slice(0, 100) + '…' : value}
      </span>
    </div>
  )
}

interface PositionedNode extends GraphNode {
  x: number
  y: number
  tx?: number
  ty?: number
}

function useForceLayout(data: GraphData, dimensions: { width: number; height: number }) {
  const [layout, setLayout] = useState<{ nodes: PositionedNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] })
  const animRef = useRef<number>(0)
  const prevNodesRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setLayout({ nodes: [], edges: [] })
      return
    }

    if (animRef.current) cancelAnimationFrame(animRef.current)

    const { width, height } = dimensions
    const prevPositions = prevNodesRef.current

    const nodes = data.nodes.map((n, i) => {
      const prev = prevPositions.get(n.id)
      if (prev) {
        return { ...n, x: prev.x, y: prev.y, tx: 0, ty: 0 }
      }
      return {
        ...n,
        x: (width / 2) + (Math.cos(i * 2.39996) * Math.min(width, height) * 0.35),
        y: (height / 2) + (Math.sin(i * 2.39996) * Math.min(width, height) * 0.35),
        tx: 0,
        ty: 0,
      }
    })

    const iterations = 30
    const targetPositions: { x: number; y: number }[] = []

    for (let i = 0; i < nodes.length; i++) {
      targetPositions.push({ x: nodes[i].x, y: nodes[i].y })
    }

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = targetPositions[j].x - targetPositions[i].x
          const dy = targetPositions[j].y - targetPositions[i].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 400 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          targetPositions[i].x -= fx
          targetPositions[i].y -= fy
          targetPositions[j].x += fx
          targetPositions[j].y += fy
        }
      }
      for (const edge of data.edges) {
        const si = nodes.findIndex((n) => n.id === edge.source)
        const ti = nodes.findIndex((n) => n.id === edge.target)
        if (si === -1 || ti === -1) continue
        const dx = targetPositions[ti].x - targetPositions[si].x
        const dy = targetPositions[ti].y - targetPositions[si].y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 70) * 0.008
        targetPositions[si].x += (dx / dist) * force
        targetPositions[si].y += (dy / dist) * force
        targetPositions[ti].x -= (dx / dist) * force
        targetPositions[ti].y -= (dy / dist) * force
      }
      for (const pos of targetPositions) {
        pos.x = Math.max(40, Math.min(width - 40, pos.x))
        pos.y = Math.max(40, Math.min(height - 40, pos.y))
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      nodes[i].tx = targetPositions[i].x - nodes[i].x
      nodes[i].ty = targetPositions[i].y - nodes[i].y
    }

    let frame = 0
    const totalFrames = 20

    const animate = () => {
      frame++
      const t = Math.min(frame / totalFrames, 1)
      const ease = 1 - Math.pow(1 - t, 3)

      const interpolated = nodes.map((n) => ({
        ...n,
        x: n.x + (n.tx || 0) * ease,
        y: n.y + (n.ty || 0) * ease,
      }))

      setLayout({ nodes: interpolated, edges: data.edges })

      if (frame < totalFrames) {
        animRef.current = requestAnimationFrame(animate)
      } else {
        const posMap = new Map<string, { x: number; y: number }>()
        for (const n of nodes) {
          posMap.set(n.id, { x: n.x + (n.tx || 0), y: n.y + (n.ty || 0) })
        }
        prevNodesRef.current = posMap
      }
    }

    animRef.current = requestAnimationFrame(animate)

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [data, dimensions])

  return layout
}
