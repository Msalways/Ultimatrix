import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import type { HuntPrompt } from '../cli/prompt';

let _currentPrompt: HuntPrompt | null = null;

export function setCurrentPrompt(prompt: HuntPrompt | null): void {
  _currentPrompt = prompt;
}

export function getCurrentPrompt(): HuntPrompt | null {
  return _currentPrompt;
}

export function createAskUserTool() {
  return tool(async ({ question, options: opts }) => {
    const p = _currentPrompt;
    if (!p) return 'No prompt available — cannot ask user';
    p.notify(`\x1b[1;33m[ask_user]\x1b[0m ${question}`);
    if (opts?.length) {
      p.notify(`\x1b[2m  Options: ${opts.join(', ')}\x1b[0m`);
    }
    const answer = await p.nextLine();
    return answer ?? 'User closed the prompt';
  }, {
    name: 'ask_user',
    description: 'Ask the user a question and wait for their response. Use this when you need credentials, permission, clarification, or to explain findings.',
    schema: z.object({
      question: z.string().describe('Your question for the user'),
      options: z.array(z.string()).optional().describe('Suggested response options'),
    }),
  });
}
