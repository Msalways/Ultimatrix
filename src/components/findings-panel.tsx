'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'

const severityColors: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
  info: 'outline',
}

interface Finding {
  id: string
  label: string
  properties: {
    severity: string
    technique: string
    endpoint: string
    evidence: string[]
    remediation?: string
    cwe?: string
    confidence: number
  }
  createdAt: number
}

export function FindingsPanel() {
  const [findings, setFindings] = useState<Finding[]>([])
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [techniqueFilter, setTechniqueFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    function fetchFindings() {
      fetch('/api/findings')
        .then(r => r.json())
        .then(d => setFindings(d.findings ?? []))
        .catch(() => {})
    }
    fetchFindings()
    const id = setInterval(fetchFindings, 3000)
    return () => clearInterval(id)
  }, [])

  const techniques = [...new Set(findings.map(f => f.properties.technique).filter(Boolean))].sort()

  const filtered = findings.filter(f => {
    if (severityFilter !== 'all' && f.properties.severity !== severityFilter) return false
    if (techniqueFilter !== 'all' && f.properties.technique !== techniqueFilter) return false
    return true
  })

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ findings: filtered, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ultimatrix-findings-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-border px-6 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Findings ({filtered.length})</h2>
          {filtered.length > 0 && (
            <button onClick={handleExport} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Download size={12} /> Export
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {['all', 'critical', 'high', 'medium', 'low'].map(s => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`text-xs px-2 py-1 rounded-full transition-colors ${
                severityFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
          {techniques.length > 1 && (
            <span className="w-px h-4 bg-border mx-1" />
          )}
          {techniques.map(t => (
            <button
              key={t}
              onClick={() => setTechniqueFilter(techniqueFilter === t ? 'all' : t)}
              className={`text-xs px-2 py-1 rounded-full transition-colors ${
                techniqueFilter === t ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3 max-w-3xl mx-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No findings yet. Run an assessment first.</p>
          )}
          {filtered.map(f => {
            const isExpanded = expandedId === f.id
            return (
              <Card key={f.id}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : f.id)}
                  className="w-full text-left"
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {isExpanded ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                        <CardTitle className="text-sm font-mono truncate">{f.properties.technique}</CardTitle>
                      </div>
                      <Badge variant={severityColors[f.properties.severity] ?? 'default'} className="shrink-0">
                        {f.properties.severity}
                      </Badge>
                    </div>
                  </CardHeader>
                </button>
                <CardContent className="p-4 pt-2 text-xs text-muted-foreground">
                  <p className="font-mono mb-1 truncate">{f.properties.endpoint}</p>
                  {f.properties.evidence?.slice(0, isExpanded ? undefined : 2).map((ev, i) => (
                    <p key={i} className={isExpanded ? '' : 'truncate'}>{ev}</p>
                  ))}
                  {!isExpanded && (f.properties.evidence?.length ?? 0) > 2 && (
                    <p className="text-[11px] text-muted-foreground/60 mt-1">+{f.properties.evidence.length - 2} more</p>
                  )}
                  <p className="mt-1">Confidence: {Math.round(f.properties.confidence * 100)}%</p>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-border space-y-2">
                      {f.properties.remediation && (
                        <div>
                          <span className="font-medium text-foreground">Remediation: </span>
                          <span>{f.properties.remediation}</span>
                        </div>
                      )}
                      {f.properties.cwe && (
                        <div>
                          <span className="font-medium text-foreground">CWE: </span>
                          <span>{f.properties.cwe}</span>
                        </div>
                      )}
                      {f.properties.evidence && f.properties.evidence.length > 0 && (
                        <div>
                          <span className="font-medium text-foreground">Evidence ({f.properties.evidence.length}):</span>
                          <div className="mt-1 space-y-1">
                            {f.properties.evidence.map((ev, i) => (
                              <pre key={i} className="text-[11px] bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{ev}</pre>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-4 text-[11px] text-muted-foreground/60">
                        <span>ID: {f.id.slice(0, 12)}...</span>
                        <span>Created: {new Date(f.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
