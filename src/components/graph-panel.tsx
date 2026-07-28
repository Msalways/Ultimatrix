'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { RefreshCw, Maximize2, Minimize2 } from 'lucide-react'
import { useSessionStore } from '@/stores/session-store'
import { cn } from '@/lib/utils'

interface GraphNode {
  id: string
  type: string
  label: string
}

interface GraphEdge {
  source: string
  target: string
  type: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

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

const NODE_SHAPES: Record<string, string> = {
  Page: 'circle',
  Endpoint: 'diamond',
  Finding: 'star',
  Action: 'square',
  AuthFlow: 'triangle',
  Fact: 'circle',
}

function getNodeColor(type: string): string {
  return NODE_COLORS[type] || '#6b7280'
}

export function GraphPanel() {
  const activeTarget = useSessionStore((s) => s.activeTarget)
  const [data, setData] = useState<GraphData | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  const fetchGraph = useCallback(async () => {
    if (!activeTarget) return
    setLoading(true)
    try {
      const res = await fetch(`/api/graph?target=${encodeURIComponent(activeTarget)}`)
      const json = await res.json()
      setData(json)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [activeTarget])

  useEffect(() => {
    fetchGraph()
    const interval = setInterval(fetchGraph, 10_000)
    return () => clearInterval(interval)
  }, [fetchGraph])

  const summary = useGraphSummary(data)

  return (
    <div className={cn(
      'flex flex-col border-l border-zinc-800 bg-zinc-950',
      expanded ? 'w-full' : 'w-80',
    )}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-400">Graph</span>
        <div className="flex items-center gap-1">
          <button onClick={fetchGraph} className="p-1 text-zinc-500 hover:text-zinc-300">
            <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-zinc-500 hover:text-zinc-300">
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {data && data.nodes.length > 0 ? (
          <GraphVisualization data={data} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            {activeTarget ? 'No graph data yet' : 'Select a target'}
          </div>
        )}
      </div>

      {summary && (
        <div className="border-t border-zinc-800 px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between text-zinc-400">
            <span>Endpoints</span>
            <span>{summary.endpoints}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Findings</span>
            <span className={cn(summary.findings > 0 && 'text-red-400')}>{summary.findings}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Auth Flows</span>
            <span>{summary.authFlows}</span>
          </div>
          <div className="flex justify-between text-zinc-400">
            <span>Total nodes</span>
            <span>{summary.totalNodes}</span>
          </div>
        </div>
      )}
    </div>
  )
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

  // Simple force layout simulation
  const { nodes, edges } = useForceLayout(data, dimensions)

  return (
    <svg ref={svgRef} className="w-full h-full" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="6" markerHeight="4" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#52525b" />
        </marker>
      </defs>
      {edges.map((edge, i) => {
        const source = nodes.find((n) => n.id === edge.source)
        const target = nodes.find((n) => n.id === edge.target)
        if (!source || !target) return null
        return (
          <line
            key={`e-${i}`}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            stroke="#27272a"
            strokeWidth={1}
            markerEnd="url(#arrowhead)"
          />
        )
      })}
      {nodes.map((node) => (
        <g key={node.id}>
          <circle
            cx={node.x}
            cy={node.y}
            r={node.type === 'Finding' ? 6 : node.type === 'Endpoint' ? 5 : 4}
            fill={getNodeColor(node.type)}
            opacity={0.8}
          />
          {node.label && (
            <text
              x={node.x}
              y={node.y + 12}
              textAnchor="middle"
              className="fill-zinc-500"
              fontSize={8}
            >
              {node.label.length > 20 ? node.label.slice(0, 20) + '...' : node.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

interface PositionedNode extends GraphNode {
  x: number
  y: number
}

function useForceLayout(data: GraphData, dimensions: { width: number; height: number }) {
  const [layout, setLayout] = useState<{ nodes: PositionedNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] })

  useEffect(() => {
    if (!data || data.nodes.length === 0) {
      setLayout({ nodes: [], edges: [] })
      return
    }

    const { width, height } = dimensions
    const nodes = data.nodes.map((n, i) => ({
      ...n,
      x: (width / 2) + (Math.cos(i * 2.39996) * Math.min(width, height) * 0.35),
      y: (height / 2) + (Math.sin(i * 2.39996) * Math.min(width, height) * 0.35),
    }))

    // Simple repulsion simulation (10 iterations)
    for (let iter = 0; iter < 10; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x
          const dy = nodes[j].y - nodes[i].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 500 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          nodes[i].x -= fx
          nodes[i].y -= fy
          nodes[j].x += fx
          nodes[j].y += fy
        }
      }
      // Pull connected nodes together
      for (const edge of data.edges) {
        const source = nodes.find((n) => n.id === edge.source)
        const target = nodes.find((n) => n.id === edge.target)
        if (!source || !target) continue
        const dx = target.x - source.x
        const dy = target.y - source.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 60) * 0.01
        source.x += (dx / dist) * force
        source.y += (dy / dist) * force
        target.x -= (dx / dist) * force
        target.y -= (dy / dist) * force
      }
      // Keep within bounds
      for (const node of nodes) {
        node.x = Math.max(30, Math.min(width - 30, node.x))
        node.y = Math.max(30, Math.min(height - 30, node.y))
      }
    }

    setLayout({ nodes, edges: data.edges })
  }, [data, dimensions])

  return layout
}
