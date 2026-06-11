import { stdin, stdout } from 'node:process'

function isStdinTTY(): boolean {
  return !!stdin.isTTY
}

function resumeStdin(): void {
  if (stdin.isPaused()) stdin.resume()
}

export function readLine(prompt = ''): Promise<string> {
  if (prompt) stdout.write(prompt)
  resumeStdin()
  return new Promise((resolve) => {
    const handler = (data: Buffer) => {
      const text = data.toString('utf-8')
      const idx = text.indexOf('\n')
      if (idx >= 0) {
        stdin.removeListener('data', handler)
        resolve(text.slice(0, idx).replace(/\r$/, ''))
        if (!isStdinTTY()) resumeStdin()
      }
    }
    stdin.on('data', handler)
    if (!isStdinTTY()) resumeStdin()
  })
}

export function promptUser(question: string, options?: string[]): Promise<string> {
  const prompt = options?.length
    ? question + ' [' + options.join(' | ') + '] '
    : question + ' '
  return readLine(prompt)
}
