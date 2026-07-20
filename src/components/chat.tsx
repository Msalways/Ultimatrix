'use client'

import { useChat } from '@ai-sdk/react'
import { useState, useRef, useCallback, useEffect } from 'react'
import { Send, Square, Loader2, X, AlertTriangle, Search, Globe, Zap, Github } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { BuddyMessage } from './BuddyMessage'
import { createRenderModel } from '../output/render-model'

/**
 * Adapts a plain assistant content string into the shared RenderModel so the
 * markdown/highlight renderer is used. Once /api/chat streams SolverStreamMessage
 * (T4.1), this panel switches to useRenderModel(); the renderer is identical.
 */
function BuddyMessageContent({ content }: { content: string }) {
  const model = { ...createRenderModel(), answer: content, complete: true }
  return <BuddyMessage model={model} />
}

const TOOL_LABELS: Record<string, string> = {
  stagehand_navigate: 'Navigating',
  stagehand_act: 'Interacting with page',
  stagehand_extract: 'Extracting page data',
  stagehand_observe: 'Observing page state',
  httpRequest: 'Sending HTTP request',
  followRedirects: 'Following redirect chain',
  parseResponse: 'Parsing response',
  evaluateRendered: 'Evaluating JS on page',
  measureTiming: 'Measuring response timing',
  compareResponses: 'Comparing responses',
  checkWaf: 'Checking WAF detection',
  findEndpointsInResponse: 'Discovering endpoints',
  extractSessionCookie: 'Extracting session cookie',
  extractCsrfToken: 'Extracting CSRF token',
  useSession: 'Using saved session',
  injectInContext: 'Injecting payload',
  recordEvidence: 'Recording evidence',
  writeFinding: 'Writing finding',
  queryGraph: 'Querying attack graph',
  updateGraph: 'Updating attack graph',
  getTestCoverage: 'Checking test coverage',
  getUntestedActions: 'Finding untested actions',
  getAttackPath: 'Mapping attack path',
  getAuthFlows: 'Analyzing auth flows',
  runRecon: 'Running recon',
  graphqlIntrospect: 'Introspecting GraphQL',
  jwtDecode: 'Decoding JWT',
  frameworkFingerprint: 'Fingerprinting framework',
  cloudMetadataProbe: 'Probing cloud metadata',
  getOastUrlTool: 'Getting OAST callback URL',
  checkOastCallbacks: 'Checking OAST callbacks',
  delegateToWorker: 'Delegating to specialist',
}

const QUICK_ACTIONS = [
  { icon: Search, label: 'Scan URL', description: 'Crawl pages, find forms, detect endpoints' },
  { icon: Globe, label: 'Spider Crawl', description: 'Full discovery — pages, overlays, auth flows' },
  { icon: Zap, label: 'Full Assessment', description: 'Complete vuln scan across all attack classes' },
  { icon: Github, label: 'Analyze Auth', description: 'Detect login/logout flows and RBAC' },
] as const

function getThreadId(): string {
  if (typeof window === 'undefined') return 'ssr'
  let id = localStorage.getItem('ultimatrix-thread-id')
  if (!id) {
    id = 'ultimatrix-web-' + Date.now()
    localStorage.setItem('ultimatrix-thread-id', id)
  }
  return id
}

function getStoredMessages() {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem('ultimatrix-messages') || '[]')
  } catch { return [] }
}

function storeMessages(msgs: any[]) {
  if (typeof window === 'undefined') return
  try {
    const recent = msgs.slice(-50)
    localStorage.setItem('ultimatrix-messages', JSON.stringify(recent))
    localStorage.setItem('ultimatrix-message-count', String(msgs.length))
  } catch { /* quota */ }
}

interface ToastData {
  type: 'success' | 'error' | 'warning'
  message: string
}

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])
  const colors = { success: 'bg-green-500/10 border-green-500/30 text-green-600', error: 'bg-destructive/10 border-destructive/20 text-destructive', warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600' }
  return (
    <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg border text-sm shadow-lg ${colors[toast.type]}`}>
      {toast.type === 'error' ? <AlertTriangle size={14} /> : toast.type === 'warning' ? <AlertTriangle size={14} /> : <Check size={14} />}
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100"><X size={14} /></button>
    </div>
  )
}

export function ChatPanel() {
  const [targetUrl, setTargetUrl] = useState('')
  const [savingTarget, setSavingTarget] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [targetSaved, setTargetSaved] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)
  const threadId = useRef(getThreadId())
  const initPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup init polling on unmount
  useEffect(() => {
    return () => {
      if (initPollRef.current) {
        clearInterval(initPollRef.current)
        initPollRef.current = null
      }
    }
  }, [])

  // Load persisted target on mount
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        if (cfg.target) setTargetUrl(cfg.target)
      })
      .catch(() => {})
  }, [])

  const messagesRef = useRef<any[]>([])
  const { messages, input, handleInputChange, handleSubmit, isLoading, stop, error: chatError, setInput, append, setMessages } = useChat({
    api: '/api/chat',
    id: threadId.current,
    initialMessages: getStoredMessages(),
    onFinish: (msg) => {
      const updated = [...messagesRef.current, msg]
      messagesRef.current = updated
      storeMessages(updated)
    },
  })
  messagesRef.current = messages

  const saveTarget = useCallback(async (url: string): Promise<boolean> => {
    setSavingTarget(true)
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: url || undefined }),
      })
      if (!res.ok) {
        const data = await res.json()
        setToast({ type: 'error', message: data.error || 'Failed to save target' })
        return false
      }
      setTargetSaved(true)
      setTimeout(() => setTargetSaved(false), 3000)
      return true
    } catch (e) {
      setToast({ type: 'error', message: 'Network error saving target' })
      return false
    } finally {
      setSavingTarget(false)
    }
  }, [])

  const sendAction = useCallback(async (label: string, prompt: string) => {
    // Save target first
    if (targetUrl) {
      const ok = await saveTarget(targetUrl)
      if (!ok) return
    }
    // Track init progress
    setInitError(null)
    setIsInitializing(true)
    const startTime = Date.now()
    initPollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/status')
        const data = await res.json()
        if (data.phase === 'ready' || data.initialized) {
          clearInterval(initPollRef.current!)
          initPollRef.current = null
          setIsInitializing(false)
        }
        if (data.initError) {
          setInitError(data.initError)
        }
      } catch {}
    }, 500)
    // Timeout after 30s
    setTimeout(() => {
      if (initPollRef.current) {
        clearInterval(initPollRef.current)
        initPollRef.current = null
        setIsInitializing(false)
        if (Date.now() - startTime >= 29000) {
          setInitError('Agent failed to start within 30s. Check your API key in Settings or restart.')
        }
      }
    }, 30000)
    // Send the action prompt
    append({ role: 'user', content: prompt })
  }, [targetUrl, append, saveTarget])

  // Keyboard shortcuts
  const targetInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isLoading) stop()
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        targetInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isLoading, stop])

  const handleTargetSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetUrl.trim()) return
    await saveTarget(targetUrl)
  }, [targetUrl, saveTarget])

  const handleClearTarget = useCallback(async () => {
    setTargetUrl('')
    await saveTarget('')
  }, [saveTarget])

  const hasAnyError = initError || chatError

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}

      {/* Target URL bar */}
      <div className="border-b border-border px-4 py-2 bg-muted/30">
        <form onSubmit={handleTargetSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <Globe size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={targetInputRef}
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
              placeholder="Set target URL... (e.g. https://example.com) [Ctrl+K]"
              className="w-full pl-8 pr-8 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {targetUrl && (
              <button
                type="button"
                onClick={handleClearTarget}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Clear target"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={savingTarget || !targetUrl.trim()}>
            {savingTarget ? <Loader2 size={12} className="animate-spin" /> : targetSaved ? <Check size={12} className="text-green-500" /> : 'Set Target'}
          </Button>
        </form>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-4 max-w-3xl mx-auto">
          {messages.length === 0 && !hasAnyError && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-muted-foreground">
              <Bug size={40} className="opacity-30 mb-4" />
              <p className="text-sm mb-1">Ready to investigate.</p>
              <p className="text-xs mb-6">Set a target URL above, then choose an action or type a message.</p>

              <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action.label}
                    disabled={isInitializing || isLoading}
                    title={`Send: ${
                      action.label === 'Scan URL'
                        ? `Navigate to ${targetUrl || '[target]'} and scan for vulnerabilities`
                        : action.label === 'Spider Crawl'
                        ? `Navigate to ${targetUrl || '[target]'} with stagehand for full discovery`
                        : action.label === 'Full Assessment'
                        ? `Run complete vuln scan on ${targetUrl || '[target]'}`
                        : `Analyze auth flows on ${targetUrl || '[target]'}`
                    }`}
                    onClick={() => sendAction(
                      action.label,
                      action.label === 'Scan URL'
                        ? `Navigate to ${targetUrl || '[target]'} and scan for vulnerabilities. Report all findings.`
                        : action.label === 'Spider Crawl'
                        ? `Navigate to ${targetUrl || '[target]'} using stagehand_navigate. Use stagehand tools to dismiss overlays, discover forms, detect auth flows, and record everything with updateGraph. Report all findings.`
                        : action.label === 'Full Assessment'
                        ? `Run a full security assessment on ${targetUrl || '[target]'}. Test for injection, XSS, IDOR, auth bypass, race conditions, and logic flaws. Report all findings with severity.`
                        : `Navigate to ${targetUrl || '[target]'} and analyze the authentication flow. Detect login/logout/refresh patterns and RBAC roles.`
                    )}
                    className={`flex flex-col items-start gap-1 p-3 rounded-lg border border-border bg-card transition-colors text-left ${(isInitializing || isLoading) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent'}`}
                  >
                    <action.icon size={16} className="text-primary" />
                    <span className="text-xs font-medium text-foreground">{action.label}</span>
                    <span className="text-[11px] text-muted-foreground leading-tight">{action.description}</span>
                  </button>
                ))}
              </div>

              {!targetUrl && (
                <p className="text-xs text-yellow-500 mt-4">⚠ Set a target URL above first for best results.</p>
              )}
            </div>
          )}

          {isInitializing && (
            <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              <span>Starting browser + agents...</span>
            </div>
          )}

          {initError && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {initError}
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Restart Agent
                </Button>
              </div>
            </div>
          )}

          {chatError && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                Connection error: {chatError.message}
              </div>
              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
                    } catch {}
                    window.location.reload()
                  }}
                >
                  Restart Agent
                </Button>
              </div>
            </div>
          )}

           {messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}>
                <div className="font-medium text-xs mb-1 opacity-70">
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </div>
                {m.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <BuddyMessageContent content={m.content} />
                )}
                {m.toolInvocations && m.toolInvocations.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {m.toolInvocations.map((inv, i) => (
                      <div key={i} className="text-xs bg-background/50 rounded p-1.5 text-muted-foreground">
                        {TOOL_LABELS[inv.toolName as keyof typeof TOOL_LABELS] || inv.toolName}
                        {inv.state === 'partial-call' ? '…' : inv.state === 'result' ? ' ✓' : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
                <Loader2 size={14} className="animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border p-4 bg-card">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto">
          <Input
            value={input}
            onChange={handleInputChange}
            placeholder={targetUrl ? 'Ask something about the target...' : 'Type a message...'}
            disabled={isLoading || isInitializing}
          />
          {isLoading ? (
            <Button type="button" variant="destructive" size="icon" onClick={stop}>
              <Square size={16} />
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim() || isInitializing}>
              <Send size={16} />
            </Button>
          )}
        </form>
      </div>
    </div>
  )
}
