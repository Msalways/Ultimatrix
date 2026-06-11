const MAX_BUFFER = 500

let debugBuffer: string[] = []
let originalLog: typeof console.log | null = null
let originalError: typeof console.error | null = null

export function captureConsole(): () => void {
  originalLog = console.log
  originalError = console.error

  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ')
    debugBuffer.push(line)
    if (debugBuffer.length > MAX_BUFFER) debugBuffer.shift()
  }

  console.error = (...args: unknown[]) => {
    const line = args.map(String).join(' ')
    debugBuffer.push('[ERR] ' + line)
    if (debugBuffer.length > MAX_BUFFER) debugBuffer.shift()
  }

  return restoreConsole
}

export function restoreConsole(): void {
  if (originalLog) console.log = originalLog
  if (originalError) console.error = originalError
  originalLog = null
  originalError = null
}

export function getDebugBuffer(): string[] {
  return [...debugBuffer]
}
