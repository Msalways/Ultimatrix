'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function usePhaseRipple() {
  const [ripple, setRipple] = useState(false);

  const triggerRipple = useCallback(() => {
    setRipple(true);
    const t = setTimeout(() => setRipple(false), 600);
    return () => clearTimeout(t);
  }, []);

  return { ripple, triggerRipple };
}

export function PhaseIndicator({
  currentPhase,
  className,
}: {
  currentPhase: number;
  className?: string;
}) {
  const { ripple, triggerRipple } = usePhaseRipple();

  useEffect(() => {
    triggerRipple();
  }, [currentPhase, triggerRipple]);

  return (
    <div className={cn('relative flex items-center justify-center', className)}>
      <div className="relative h-12 w-12">
        <svg width="48" height="48" viewBox="0 0 48 48">
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke="var(--ultimatrix-green)"
            strokeWidth="2"
            opacity="0.2"
          />
          {[0, 90, 180, 270].map((angle, i) => {
            const active = i <= currentPhase;
            return (
              <circle
                key={i}
                cx={24 + 18 * Math.cos(((angle - 90) * Math.PI) / 180)}
                cy={24 + 18 * Math.sin(((angle - 90) * Math.PI) / 180)}
                r="4"
                fill={active ? 'var(--ultimatrix-green)' : 'transparent'}
                stroke={active ? 'var(--ultimatrix-green)' : 'rgba(43,224,138,0.2)'}
                strokeWidth="1.5"
                className="transition-all duration-500"
              />
            );
          })}
        </svg>
      </div>

      {ripple && (
        <div
          className="absolute inset-0 rounded-full border-2 border-green-400 animate-ripple pointer-events-none"
          style={{ margin: 'auto', width: '100%', height: '100%' }}
        />
      )}
    </div>
  );
}
