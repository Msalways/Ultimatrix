'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfigSectionProps {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function ConfigSection({ title, description, defaultOpen = false, children }: ConfigSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-900/50 hover:bg-zinc-900 transition-colors"
      >
        <div className="text-left">
          <div className="text-xs font-medium text-zinc-200">{title}</div>
          {description && <div className="text-xs text-zinc-500 mt-0.5">{description}</div>}
        </div>
        <ChevronDown
          size={14}
          className={cn('text-zinc-500 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-zinc-800">
          {children}
        </div>
      )}
    </div>
  )
}
