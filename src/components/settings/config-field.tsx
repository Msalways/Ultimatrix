import { type ReactNode } from 'react'

interface ConfigFieldProps {
  label: string
  description?: string
  error?: string
  children: ReactNode
}

export function ConfigField({ label, description, error, children }: ConfigFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-zinc-300">{label}</label>
      {description && <p className="text-xs text-zinc-500">{description}</p>}
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
