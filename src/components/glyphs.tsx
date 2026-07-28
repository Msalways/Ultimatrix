import { cn } from '@/lib/utils';

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type StatusState = 'active' | 'idle' | 'loading' | 'complete' | 'error';

const threatGlyphs: Record<ThreatSeverity, string> = {
  critical: '\u26A1',
  high: '\u26A0',
  medium: '\u25C6',
  low: '\u25CB',
  info: '\u25C7',
};

const threatColors: Record<ThreatSeverity, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  info: 'text-gray-400',
};

export function ThreatGlyph({
  severity,
  className,
}: {
  severity: ThreatSeverity;
  className?: string;
}) {
  return (
    <span
      className={cn('text-lg select-none', threatColors[severity], className)}
      aria-hidden="true"
    >
      {threatGlyphs[severity]}
    </span>
  );
}

const statusGlyphs: Record<StatusState, string> = {
  active: '\u25CF',
  idle: '\u25CB',
  loading: '\u25CC',
  complete: '\u25C9',
  error: '\u25D7',
};

export function StatusGlyph({
  status,
  className,
}: {
  status: StatusState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-sm font-mono',
        status === 'active' && 'text-green-400 animate-glyph-pulse',
        status === 'idle' && 'text-gray-600',
        status === 'loading' && 'text-green-400 animate-glyph-spin',
        status === 'complete' && 'text-green-500',
        status === 'error' && 'text-red-400',
        className,
      )}
      aria-label={`Status: ${status}`}
    >
      {statusGlyphs[status]}
    </span>
  );
}
