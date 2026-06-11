import { Box, useInput, useStdout } from 'silvery'
import { useCallback } from 'react'
import { ChatPanel } from './ChatPanel'
import { Sidebar } from './Sidebar'
import { useTuiState } from './useTuiState'
import { ErrorBoundary } from './ErrorBoundary'

interface Props {
  targetUrl?: string
  modelName?: string
  sendMessage: (text: string, onToken?: (token: string) => void) => Promise<string>
}

export function App({ targetUrl, modelName, sendMessage }: Props) {
  const {
    messages, activities, graphStats, inputText, setInputText, isResponding, onSubmit, clearMessages,
  } = useTuiState(sendMessage)

  const { stdout } = useStdout()
  const width = stdout?.columns ?? 80

  useInput((_input, key) => {
    if (key.ctrl && _input === 'l') {
      clearMessages()
    }
    if (key.ctrl && _input === 'd') {
      process.exit(0)
    }
    if (key.ctrl && _input === 'c') {
      process.exit(0)
    }
  })

  if (width < 80) {
    return (
      <ErrorBoundary>
        <Box flexDirection="column" width="100%" height="100%">
          <ChatPanel
            messages={messages}
            inputText={inputText}
            isResponding={isResponding}
            findings={graphStats.findings}
            targetUrl={targetUrl}
            modelName={modelName}
            onInputChange={setInputText}
            onSubmit={onSubmit}
          />
          <Box height={1} />
          <Sidebar activities={activities} graphStats={graphStats} />
        </Box>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <Box flexDirection="row" width="100%" height="100%">
        <ChatPanel
          messages={messages}
          inputText={inputText}
          isResponding={isResponding}
          findings={graphStats.findings}
          targetUrl={targetUrl}
          modelName={modelName}
          onInputChange={setInputText}
          onSubmit={onSubmit}
        />
        <Sidebar activities={activities} graphStats={graphStats} />
      </Box>
    </ErrorBoundary>
  )
}
