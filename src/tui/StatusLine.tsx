import { Text } from 'silvery'

interface Props {
  targetUrl?: string
  modelName?: string
  findings: number
}

export function StatusLine({ targetUrl, modelName, findings }: Props) {
  const parts: string[] = []
  if (targetUrl) parts.push(`Target: ${targetUrl}`)
  if (modelName) parts.push(`Model: ${modelName}`)
  parts.push(`Findings: ${findings}`)

  return <Text color="gray">{parts.join(' | ')}</Text>
}
