'use client'

import { useEffect, useState, useMemo } from 'react'
import { Search, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ProviderInfo {
  id: string
  name: string
  defaultBaseUrl: string
  envVar: string
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  nvidia: 'meta/llama-3.1-8b-instruct',
  groq: 'llama3-8b-8192',
  together: 'meta-llama/Llama-3-70b-chat-hf',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-large-latest',
  xai: 'grok-2',
  perplexity: 'llama-3.1-sonar-large-128k-online',
  cerebras: 'llama3.1-8b',
  deepinfra: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
  openrouter: 'meta-llama/llama-3.1-70b-instruct',
  cohere: 'command-r-plus',
  ollama: 'llama3',
  azure: 'gpt-4o',
  bedrock: 'anthropic.claude-3-sonnet-20240222-v1:0',
}

export function getDefaultModel(providerId: string): string {
  return DEFAULT_MODELS[providerId] ?? ''
}

const POPULAR_IDS = new Set(['groq', 'openai', 'anthropic', 'google', 'nvidia'])

const PROVIDER_META: Record<string, { desc: string; color: string; letter: string }> = {
  groq: { desc: 'Ultra-fast inference, free tier', color: 'bg-orange-500', letter: 'G' },
  openai: { desc: 'GPT-4o, o1, o3 models', color: 'bg-emerald-600', letter: 'O' },
  anthropic: { desc: 'Claude Sonnet, Opus', color: 'bg-amber-600', letter: 'A' },
  google: { desc: 'Gemini Flash, Pro', color: 'bg-blue-600', letter: 'G' },
  nvidia: { desc: 'NIM-hosted open models', color: 'bg-green-700', letter: 'N' },
  together: { desc: 'Open-source model host', color: 'bg-violet-600', letter: 'T' },
  deepseek: { desc: 'DeepSeek-V3, R1', color: 'bg-sky-600', letter: 'D' },
  mistral: { desc: 'Mistral Large, Medium', color: 'bg-orange-700', letter: 'M' },
  xai: { desc: 'Grok-2, Grok-3', color: 'bg-zinc-500', letter: 'X' },
  perplexity: { desc: 'Sonar online models', color: 'bg-indigo-600', letter: 'P' },
  cerebras: { desc: 'Inference-engine speed', color: 'bg-teal-600', letter: 'C' },
  deepinfra: { desc: 'DeepInfra hosted models', color: 'bg-cyan-700', letter: 'D' },
  openrouter: { desc: 'Multi-provider router', color: 'bg-rose-600', letter: 'R' },
  cohere: { desc: 'Command-R, Embed', color: 'bg-pink-600', letter: 'C' },
  ollama: { desc: 'Local model serving', color: 'bg-zinc-600', letter: 'O' },
  azure: { desc: 'Azure OpenAI Service', color: 'bg-blue-700', letter: 'A' },
  bedrock: { desc: 'AWS Bedrock models', color: 'bg-amber-700', letter: 'B' },
}

interface ProviderPickerProps {
  onSelect: (provider: ProviderInfo) => void
}

export function ProviderPicker({ onSelect }: ProviderPickerProps) {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/config/providers')
      .then((r) => r.json())
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const entries = Object.values(providers)
  const filtered = useMemo(() => {
    if (!search) return entries
    const q = search.toLowerCase()
    return entries.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q))
  }, [entries, search])

  const popular = filtered.filter((p) => POPULAR_IDS.has(p.id))
  const rest = filtered.filter((p) => !POPULAR_IDS.has(p.id))

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-9 rounded-md bg-zinc-900 animate-pulse" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-zinc-900 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search providers…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 pl-9 pr-3 py-2 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-700"
        />
      </div>

      {popular.length > 0 && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 mb-1.5 flex items-center gap-1">
            <Sparkles size={10} />
            Popular
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {popular.map((p) => (
              <ProviderCard key={p.id} provider={p} onClick={() => onSelect(p)} />
            ))}
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 mb-1.5">All Providers</div>
          <div className="grid grid-cols-1 gap-1.5">
            {rest.map((p) => (
              <ProviderCard key={p.id} provider={p} onClick={() => onSelect(p)} />
            ))}
          </div>
        </div>
      )}
      {filtered.length === 0 && (
        <div className="text-center text-xs text-zinc-600 py-6">
          No providers match &ldquo;{search}&rdquo;
        </div>
      )}
    </div>
  )
}

function ProviderCard({ provider, onClick }: { provider: ProviderInfo; onClick: () => void }) {
  const meta = PROVIDER_META[provider.id] || { desc: provider.defaultBaseUrl || 'Custom provider', color: 'bg-zinc-600', letter: provider.name[0] }
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2.5 text-left transition-all hover:border-zinc-700 hover:bg-zinc-800/60',
      )}
    >
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white', meta.color)}>
        {meta.letter}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100">{provider.name}</div>
        <div className="text-[11px] text-zinc-500 truncate">{meta.desc}</div>
      </div>
      <svg className="h-4 w-4 shrink-0 text-zinc-700 group-hover:text-zinc-500 transition-colors" viewBox="0 0 16 16" fill="none">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
