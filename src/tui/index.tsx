import { render } from 'silvery'
import { App } from './App'
import { captureConsole, restoreConsole } from './console-capture'

export async function startTUI(
  targetUrl?: string,
  modelName?: string,
  sendMessage?: (text: string, onToken?: (token: string) => void) => Promise<string>,
): Promise<void> {
  const restore = captureConsole()

  const actualSendMessage = sendMessage ?? (async (text: string) => text)

  try {
    await render(
      <App targetUrl={targetUrl} modelName={modelName} sendMessage={actualSendMessage} />,
    ).run()
  } finally {
    restore()
  }
}

process.on('SIGINT', () => {
  restoreConsole()
  process.exit(0)
})

process.on('SIGTERM', () => {
  restoreConsole()
  process.exit(0)
})
