import { cn } from '@/lib/utils'

function PulseBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-zinc-800/60', className)} />
}

export function GraphSkeleton() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <svg viewBox="0 0 300 200" className="h-full w-full max-w-xs opacity-40">
        <line x1="80" y1="60" x2="150" y2="90" stroke="#3f3f46" strokeWidth={1} />
        <line x1="150" y1="90" x2="220" y2="60" stroke="#3f3f46" strokeWidth={1} />
        <line x1="150" y1="90" x2="150" y2="160" stroke="#3f3f46" strokeWidth={1} />
        <line x1="80" y1="60" x2="150" y2="160" stroke="#3f3f46" strokeWidth={0.5} strokeDasharray="4 2" />
        <circle cx="80" cy="60" r="5" fill="#3f3f46" className="animate-pulse" />
        <circle cx="150" cy="90" r="6" fill="#52525b" className="animate-pulse" />
        <circle cx="220" cy="60" r="4" fill="#3f3f46" className="animate-pulse" />
        <circle cx="150" cy="160" r="4" fill="#3f3f46" className="animate-pulse" />
      </svg>
      <span className="text-xs text-zinc-600">Loading graph…</span>
    </div>
  )
}

export function FindingsSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex items-center gap-2">
            <PulseBlock className="h-3 w-3 rounded-full" />
            <PulseBlock className="h-2.5 w-12" />
            <PulseBlock className="h-2.5 w-24" />
          </div>
          <PulseBlock className="mt-2 h-2 w-36" />
          <PulseBlock className="mt-2 h-2 w-full max-w-[200px]" />
        </div>
      ))}
    </div>
  )
}

export function WorkersSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex items-center gap-2">
            <PulseBlock className="h-1.5 w-1.5 rounded-full" />
            <PulseBlock className="h-2.5 w-20" />
            <PulseBlock className="ml-auto h-2.5 w-10" />
          </div>
          <PulseBlock className="mt-2 h-2 w-full max-w-[160px]" />
          <div className="mt-2 flex gap-3">
            <PulseBlock className="h-2 w-16" />
            <PulseBlock className="h-2 w-12" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkillsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex items-center gap-2">
            <PulseBlock className="h-2.5 w-16" />
            <PulseBlock className="ml-auto h-2 w-10 rounded" />
          </div>
          <PulseBlock className="mt-2 h-2 w-full" />
          <PulseBlock className="mt-1 h-2 w-3/4" />
        </div>
      ))}
    </div>
  )
}

export function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex justify-end">
        <PulseBlock className="h-8 w-48 rounded-lg rounded-br-sm" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <PulseBlock className="h-4 w-64 rounded-lg rounded-bl-sm" />
          <PulseBlock className="h-4 w-40 rounded-lg rounded-bl-sm" />
          <PulseBlock className="h-4 w-52 rounded-lg rounded-bl-sm" />
        </div>
      </div>
      <div className="flex justify-end">
        <PulseBlock className="h-8 w-32 rounded-lg rounded-br-sm" />
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-600">
        <PulseBlock className="h-4 w-4 rounded-full" />
        <PulseBlock className="h-3 w-24" />
      </div>
    </div>
  )
}

export function TargetListSkeleton() {
  return (
    <div className="space-y-1 p-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-3 py-2.5">
          <PulseBlock className="h-3 w-3 rounded-full" />
          <div className="min-w-0 flex-1">
            <PulseBlock className="h-2.5 w-24" />
            <PulseBlock className="mt-1 h-2 w-32" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SettingsSkeleton() {
  return (
    <div className="space-y-4 p-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <PulseBlock className="h-2.5 w-20" />
          <PulseBlock className="h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  )
}
