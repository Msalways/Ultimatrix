import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { EventEmitter } from 'events'
import { getGlobalObserver } from '../capture/human-observer'
import { captureScreenshot, getActivePage } from '../browser/manager'
import { getGlobalWorkspace } from '../workspace'
import { log } from '../utils/logger'

const ASK_USER_TIMEOUT_MS = 300_000 // 5 minutes

/**
 * Ask a yes/no question on the REPL stdin and resolve to a boolean.
 * Used by the council HITL gate (decideApproval → humanApprove) so the human
 * can approve/reject high-impact proposals directly. Returns false on timeout
 * or close (fail-safe: never auto-approve).
 */
export async function askUserConfirm(question: string, timeoutMs = ASK_USER_TIMEOUT_MS): Promise<boolean> {
  const answer = await waitForInput(timeoutMs)
  if (!answer || answer === '__TIMEOUT__') return false
  return answer.trim().toLowerCase().startsWith('y')
}

export const userInputEmitter = new EventEmitter()

function waitForInput(timeoutMs = ASK_USER_TIMEOUT_MS): Promise<string> {
  if (!rl) return Promise.resolve('')
  return new Promise<string>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onLine = (line: string) => {
      cleanup()
      resolve(line.trim())
    }
    const onClose = () => {
      cleanup()
      resolve('')
    }
    const onTimeout = () => {
      cleanup()
      log.dim('⏰ Human input timed out after 5 minutes')
      resolve('__TIMEOUT__')
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      rl!.removeListener('line', onLine)
      rl!.removeListener('close', onClose)
    }
    timer = setTimeout(onTimeout, timeoutMs)
    rl!.once('line', onLine)
    rl!.once('close', onClose)
  })
}

export const askUser = createTool({
  id: 'askUser',
  description: 'Ask the user a question and wait for their response. LAST RESORT — only use when YOU are stuck and cannot proceed without human help (CAPTCHA, specific credentials needed, decision between attack paths). If the client says they will handle something, navigate to the target and let them do it instead.',
  inputSchema: z.object({
    question: z.string().describe('The question or request to show the user'),
    options: z.array(z.string()).optional().describe('Multiple choice options'),
    waitForBrowserAction: z.boolean().optional().describe('If true, wait for the user to act in the browser instead of typing. Use when you need the user to log in, solve a CAPTCHA, or perform a manual action.'),
    screenshotContext: z.string().optional().describe('Context label for the screenshot (e.g. "login-page", "captcha")'),
  }),
  execute: async ({ question, options, waitForBrowserAction, screenshotContext }) => {
    const optionsText = options?.length ? ` (${options.join(', ')})` : ''
    const fullQuestion = question + optionsText

    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()
    const outputDir = target ? workspace.getTargetDir(target) : undefined

    let screenshotPath: string | null = null
    const page = getActivePage()
    if (page) {
      screenshotPath = await captureScreenshot(screenshotContext || 'askUser', outputDir)
    }

    if (waitForBrowserAction) {
      const observer = getGlobalObserver()
      observer.startSnapshot()

      const banner = [
        '',
        '┌──────────────────────────────────────────────────┐',
        '│  👋 I need your help in the browser window.      │',
        '│                                                  │',
        `│  ${question.slice(0, 46).padEnd(46)} │`,
        '│                                                  │',
        '│  Please perform the action, then type "done"     │',
        '│  here when finished.                             │',
        '└──────────────────────────────────────────────────┘',
        '',
      ].join('\n')
      process.stdout.write(banner)

      if (screenshotPath) {
        log.dim(`📸 Screenshot before: ${screenshotPath}`)
      }

      const answer = await waitForInput()

      const humanActions = observer.getActionsSinceSnapshot()

      let afterScreenshot: string | null = null
      if (page) {
        afterScreenshot = await captureScreenshot('after-human-action', outputDir)
      }

      const pageUrl = page ? page.url() : ''
      const pageTitle = page ? await page.title().catch(() => '') : ''

      return {
        ok: true,
        value: {
          answer,
          humanActions: humanActions.map(a => ({
            type: a.type,
            selector: a.selector,
            value: a.value,
            url: a.url,
          })),
          humanActionCount: humanActions.length,
          pageUrl,
          pageTitle,
          screenshot: screenshotPath,
          screenshotAfter: afterScreenshot,
          waitForBrowserAction: true,
        },
      }
    }

    const answer = await waitForInput()

    const pageUrl = page ? page.url() : ''
    const pageTitle = page ? await page.title().catch(() => '') : ''

    return {
      ok: true,
      value: {
        answer,
        question: fullQuestion,
        pageUrl,
        pageTitle,
        screenshot: screenshotPath,
        waitForBrowserAction: false,
      },
    }
  },
})

let rl: import('readline/promises').Interface | null = null

export function setReadlineInterface(rlInterface: import('readline/promises').Interface): void {
  rl = rlInterface
}
