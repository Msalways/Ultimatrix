// src/cli/prompt.ts
//
// Readline-based prompt loop for the `hunt` command.
// Slash commands control the in-flight hunt:
//   /auto            — switch to autonomous mode (no more prompts)
//   /guided          — switch back to step-by-step
//   /findings        — print current findings table
//   /test            — generate Playwright tests from findings
//   /report          — render & open the report now
//   /add <url> [t]   — manually add a URL to the workflow graph
//   /help            — list commands
//   /quit            — exit
//
// The REPL calls back into the orchestrator's `onBeforeNode` hook for
// every discovered node and asks the user to confirm (Y), skip (s),
// investigate (i) — show details —, dismiss (d), or add a URL (a).
//
// In --auto mode, it always proceeds.

import * as readline from 'readline';

export type HuntMode = 'guided' | 'auto';

export type NodePromptAnswer = 'proceed' | 'skip' | 'abort' | 'investigate' | 'add';

export interface HuntPromptCallbacks {
  onNodePrompt: (nodeInfo: { id: string; url: string; method: string; technique: string; expectedSeverity: string }) => Promise<NodePromptAnswer>;
  onSlash: (cmd: string, args: string[]) => Promise<string>;
  onQuit: () => Promise<void>;
}

export class HuntPrompt {
  private rl: readline.Interface;
  private mode: HuntMode = 'guided';
  private closed = false;
  private buffer: string[] = [];
  private resolvers: Array<(line: string) => void> = [];

  constructor(private callbacks: HuntPromptCallbacks) {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => { this.closed = true; });
  }

  setMode(mode: HuntMode): void {
    this.mode = mode;
  }

  getMode(): HuntMode {
    return this.mode;
  }

  close(): void {
    this.closed = true;
    this.rl.close();
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('/')) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
      try {
        const result = await this.callbacks.onSlash(cmd, args);
        if (result) console.log(result);
      } catch (e) {
        console.error(`Slash error: ${(e as Error).message}`);
      }
      return;
    }
    // Push to the first waiting resolver
    const r = this.resolvers.shift();
    if (r) r(trimmed);
  }

  async ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
      process.stdout.write(question);
    });
  }

  async promptNode(info: { id: string; url: string; method: string; technique: string; expectedSeverity: string }): Promise<NodePromptAnswer> {
    if (this.mode === 'auto') return 'proceed';
    console.log('');
    console.log(`\x1b[1m── Node ${info.id.slice(0, 8)} ─────────────────\x1b[0m`);
    console.log(`  url:      \x1b[36m${info.url}\x1b[0m`);
    console.log(`  method:   ${info.method}`);
    console.log(`  technique: ${info.technique}`);
    console.log(`  severity: ${info.expectedSeverity}`);
    const answer = (await this.callbacks.onNodePrompt(info)).toString();
    if (answer === 'proceed') {
      // emit Y default
      return 'proceed';
    }
    return answer as NodePromptAnswer;
  }

  log(message: string): void {
    console.log(message);
  }

  warn(message: string): void {
    console.warn(`\x1b[33m${message}\x1b[0m`);
  }

  error(message: string): void {
    console.error(`\x1b[31m${message}\x1b[0m`);
  }
}

export const SLASH_HELP = `
Slash commands:
  /auto            switch to autonomous mode (LLM picks next plan)
  /guided          switch to step-by-step mode (you approve each plan)
  /plan            show the LLM's currently proposed plans
  /attack <n>      execute plan #n
  /findings        list current findings
  /agents          show the spawned agent tree
  /chain           run LLM-reasoned chain analysis on accumulated findings
  /test            generate Playwright tests from findings
  /report          render the HTML report now
  /add <url>       add a URL to the workflow graph
  /budget <time>   adjust the time budget (e.g. "15m", "60s")
  /help            this message
  /quit            exit the hunt
`.trim();
