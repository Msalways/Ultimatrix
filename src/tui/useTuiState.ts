import { useState, useEffect, useCallback } from 'react'
import { getGlobalEmitter } from '../events/emitter'
import type { TuiMessage, TuiActivity, TuiGraphStats } from './types'

const initialStats: TuiGraphStats = { pages: 0, actions: 0, tests: 0, findings: 0, authFlows: 0, rbacRoles: 0 }

export function useTuiState(
  sendMessageFn: (text: string, onToken?: (token: string) => void) => Promise<string>,
) {
  const [messages, setMessages] = useState<TuiMessage[]>([])
  const [activities, setActivities] = useState<TuiActivity[]>([])
  const [graphStats, setGraphStats] = useState<TuiGraphStats>(initialStats)
  const [inputText, setInputText] = useState('')
  const [isResponding, setIsResponding] = useState(false)

  const addActivity = useCallback((activity: TuiActivity) => {
    setActivities(prev => {
      const next = [...prev, activity]
      return next.length > 200 ? next.slice(-200) : next
    })
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  const clearActivities = useCallback(() => {
    setActivities([])
  }, [])

  useEffect(() => {
    const emitter = getGlobalEmitter()

    const onStart = (p: { worker: string; task: string }) => {
      addActivity({ type: 'START', message: `${p.worker}: ${p.task}`, timestamp: Date.now() })
    }
    const onComplete = (p: { worker: string; result: string }) => {
      addActivity({ type: 'DONE', message: `${p.worker}: ${p.result}`, timestamp: Date.now() })
    }
    const onError = (p: { worker: string; error: string }) => {
      addActivity({ type: 'ERROR', message: `${p.worker}: ${p.error}`, timestamp: Date.now() })
    }
    const onFinding = (p: { technique: string; severity: string; endpoint: string }) => {
      addActivity({ type: 'FIND', message: `${p.technique} (${p.severity}) on ${p.endpoint}`, timestamp: Date.now() })
      setGraphStats(prev => ({ ...prev, findings: prev.findings + 1 }))
    }
    const onSpider = (p: { url: string; status: number }) => {
      addActivity({ type: 'SPIDER', message: `${p.url} (${p.status})`, timestamp: Date.now() })
    }

    emitter.on('activity:start', onStart)
    emitter.on('activity:complete', onComplete)
    emitter.on('activity:error', onError)
    emitter.on('finding', onFinding)
    emitter.on('spider:progress', onSpider)

    return () => {
      emitter.off('activity:start', onStart)
      emitter.off('activity:complete', onComplete)
      emitter.off('activity:error', onError)
      emitter.off('finding', onFinding)
      emitter.off('spider:progress', onSpider)
    }
  }, [addActivity])

  const onSubmit = useCallback(async (text: string) => {
    if (!text.trim() || isResponding) return
    const userMsg: TuiMessage = { role: 'user', text: text.trim(), streaming: false }
    setMessages(prev => [...prev, userMsg])
    setIsResponding(true)
    setInputText('')

    const assistantMsg: TuiMessage = { role: 'assistant', text: '', streaming: true }
    setMessages(prev => [...prev, assistantMsg])

    try {
      const result = await sendMessageFn(text.trim(), (token: string) => {
        setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.streaming) {
            next[next.length - 1] = { ...last, text: last.text + token }
          }
          return next
        })
      })
      setMessages(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.streaming) {
          next[next.length - 1] = { ...last, text: result, streaming: false }
        }
        return next
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setMessages(prev => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last && last.streaming) {
          next[next.length - 1] = { ...last, text: `Error: ${errMsg}`, streaming: false }
        }
        return next
      })
      addActivity({ type: 'ERROR', message: errMsg, timestamp: Date.now() })
    } finally {
      setIsResponding(false)
    }
  }, [isResponding, sendMessageFn, addActivity])

  return {
    messages, activities, graphStats, inputText, setInputText, isResponding, onSubmit,
    clearMessages, clearActivities,
  }
}
