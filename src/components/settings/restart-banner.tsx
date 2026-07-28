import { AlertTriangle } from 'lucide-react'

interface RestartBannerProps {
  visible: boolean
}

export function RestartBanner({ visible }: RestartBannerProps) {
  if (!visible) return null
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/30 border border-amber-900/30 rounded-lg text-xs text-amber-400/80">
      <AlertTriangle size={14} />
      <span>Changes to provider, model, or engine take effect on the next session.</span>
    </div>
  )
}
