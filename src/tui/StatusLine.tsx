import { Text } from 'silvery'
import { useState, useEffect } from 'react'

interface Props {
  targetUrl?: string
  modelName?: string
  findings: number
}

export function StatusLine({ targetUrl, modelName, findings }: Props) {
  const [elapsed, setElapsed] = useState('0s')

  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000)
      const m = Math.floor(sec / 60)
      const s = sec % 60
      setElapsed(m > 0 ? `${m}m ${s}s` : `${s}s`)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const parts: string[] = []
  if (targetUrl) parts.push(`Target: ${targetUrl}`)
  if (modelName) parts.push(`Model: ${modelName}`)
  parts.push(`Findings: ${findings}`)
  parts.push(elapsed)

  return <Text color="gray">{parts.join(' | ')}</Text>
}
