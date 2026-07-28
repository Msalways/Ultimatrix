'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusGlyph } from '@/components/glyphs';
import { cn } from '@/lib/utils';

interface Worker {
  id: string | number;
  name: string;
  type: string;
  status: string;
  lastActivity: string | null;
}

export function WorkersPanel({ className }: { className?: string }) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workers');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setWorkers(json.workers ?? []);
    } catch {
      setWorkers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
    const id = setInterval(fetchWorkers, 5000);
    return () => clearInterval(id);
  }, [fetchWorkers]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
        <div className="flex items-center gap-3">
          <Cpu size={16} className="text-green-400" />
          <h2 className="text-sm font-semibold text-foreground">Workers</h2>
          <span className="text-xs text-muted-foreground">{workers.length} active</span>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchWorkers} disabled={loading}>
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {workers.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8">
            {loading ? 'Loading workers...' : 'No active workers'}
          </div>
        ) : (
          workers.map((w) => (
            <div
              key={String(w.id)}
              className="panel-holographic rounded-lg p-3 flex items-center gap-3"
            >
              <StatusGlyph
                status={
                  w.status === 'running' || w.status === 'active'
                    ? 'active'
                    : w.status === 'error'
                      ? 'error'
                      : 'idle'
                }
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{w.name}</div>
                <div className="text-xs text-muted-foreground">{w.type}</div>
              </div>
              {w.lastActivity && (
                <div className="text-xs text-muted-foreground">
                  {new Date(w.lastActivity).toLocaleTimeString()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
