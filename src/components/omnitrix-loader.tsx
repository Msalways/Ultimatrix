import { cn } from '@/lib/utils';

export function OmnitrixLoader({
  size = 48,
  phase = 'idle',
  className,
}: {
  size?: number;
  phase: 'idle' | 'loading' | 'complete';
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cn(
        'transition-all duration-300',
        phase === 'idle' && 'opacity-40',
        phase === 'loading' && 'opacity-100 animate-spin-slow',
        phase === 'complete' && 'opacity-100 scale-110',
        className,
      )}
    >
      <circle
        cx="50"
        cy="50"
        r="45"
        fill="none"
        stroke="var(--ultimatrix-green)"
        strokeWidth="2"
        opacity="0.3"
      />

      <path
        d="M35,30 L65,30 L50,50 L65,70 L35,70 L50,50 Z"
        fill="var(--ultimatrix-green)"
        className={cn(phase === 'loading' && 'animate-pulse-glow')}
      />

      {[0, 120, 240].map((angle, i) => (
        <circle
          key={i}
          cx={50 + 35 * Math.cos(((angle - 90) * Math.PI) / 180)}
          cy={50 + 35 * Math.sin(((angle - 90) * Math.PI) / 180)}
          r="4"
          fill="var(--ultimatrix-green)"
          style={{ animationDelay: `${i * 0.1}s` }}
          className={cn(phase === 'loading' && 'animate-glyph-pulse')}
        />
      ))}
    </svg>
  );
}
