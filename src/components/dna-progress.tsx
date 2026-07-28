import { cn } from '@/lib/utils';

export function DNAProgress({
  phases,
  currentPhase,
  className,
}: {
  phases: string[];
  currentPhase: number;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-16 w-2">
        <div
          className="absolute top-0 left-0 h-full w-full rounded-full"
          style={{
            background: 'linear-gradient(to bottom, var(--ultimatrix-green), #1a9c5f)',
            transform: `translateX(${currentPhase * 8}px)`,
            transition: 'transform 0.5s ease-in-out',
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        {phases.map((phase, i) => (
          <div
            key={i}
            className={cn(
              'h-3 w-24 rounded-full transition-all',
              i < currentPhase && 'bg-green-400',
              i === currentPhase && 'bg-green-500 animate-glyph-pulse',
              i > currentPhase && 'bg-gray-700',
            )}
          >
            <span className="sr-only">{phase}</span>
          </div>
        ))}
      </div>

      <div className="relative h-16 w-2">
        <div
          className="absolute top-0 right-0 h-full w-full rounded-full"
          style={{
            background: 'linear-gradient(to bottom, var(--instrument), #2a8fad)',
            transform: `translateX(-${currentPhase * 8}px)`,
            transition: 'transform 0.5s ease-in-out',
          }}
        />
      </div>
    </div>
  );
}
