import { Box, Text } from 'silvery'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { StatusLine } from './StatusLine'
import type { TuiMessage } from './types'

interface Props {
  messages: TuiMessage[]
  inputText: string
  isResponding: boolean
  findings: number
  targetUrl?: string
  modelName?: string
  onInputChange: (text: string) => void
  onSubmit: (text: string) => void
}

export function ChatPanel({
  messages, inputText, isResponding, findings,
  targetUrl, modelName, onInputChange, onSubmit,
}: Props) {
  return (
    <Box flexDirection="column" flexGrow={7} paddingX={1}>
      <Box flexGrow={1} overflow="hidden">
        <MessageList messages={messages} />
      </Box>
      <Box height={1}>
        <StatusLine targetUrl={targetUrl} modelName={modelName} findings={findings} />
      </Box>
      <Box height={3}>
        <InputBar
          value={inputText}
          onChange={onInputChange}
          onSubmit={onSubmit}
          disabled={isResponding}
        />
      </Box>
    </Box>
  )
}
