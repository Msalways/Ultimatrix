// src/cli/prompt.ts
//
// Terminal REPL for the `hunt` command.
//
// The hunt is a single, unified experience: a headed Playwright browser
// opens, the LLM starts attacking the target autonomously, and the user
// can type commands at the prompt to drive the browser or trigger
// additional attacks. User's manual clicks/inputs in the browser are
// captured for the user-flow Playwright spec.
//
// Design
// ------
// The previous version suffered from character doubling on Windows because
// readline echoes typed input while the question prompt was also being
// written — they stacked. This rewrite uses readline in `terminal: false`
// mode so it does NOT echo; we print our own prompt and render async
// output via ANSI cursor movement so the prompt is preserved.
//
// Public API
// ----------
//   const prompt = new HuntPrompt({ onCommand, onSlash, onQuit });
//   prompt.print('welcome')            // initial banner
//   while (!prompt.isClosed()) {
//     const line = await prompt.nextLine();
//     if (line === null) break;        // stdin closed
//     // dispatch...
//   }
//   prompt.close();
//
// Async output during REPL
// ------------------------
// Call `prompt.notify(text)` from anywhere (orchestrator, LLM streamer,
// finding handler). It clears the current prompt line, prints the text,
// and re-prints the prompt with the current line buffer. The user's
// typing is preserved.

import * as readline from 'readline';

export interface HuntPromptCallbacks {
  /**
   * Called for every non-slash line. Implementations route the command
   * to the browser driver, attack coordinator, etc.
   */
  onCommand: (line: string) => Promise<string | null>;
  /**
   * Called for every slash command. Returns the response to print, or
   * empty string to suppress output.
   */
  onSlash: (cmd: string, args: string[]) => Promise<string>;
  onQuit: () => Promise<void>;
}

export type ParsedPromptLine =
  | { kind: 'slash'; cmd: string; args: string[] }
  | { kind: 'command'; line: string }
  | { kind: 'empty' }
  | { kind: 'closed' };

const PROMPT_STR = '\x1b[1;36mhunt>\x1b[0m ';
const PROMPT_LEN = 6; // visible chars in "hunt> " (no ANSI codes counted)

export class HuntPrompt {
  private rl: readline.Interface;
  private closed = false;
  private buffer = '';
  private resolvers: Array<(line: string | null) => void> = [];
  private isTTY: boolean;
  private stdout: NodeJS.WriteStream;
  private stdin: NodeJS.ReadableStream;

  constructor(private callbacks: HuntPromptCallbacks, opts: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WriteStream } = {}) {
    this.stdin = opts.stdin ?? process.stdin;
    this.stdout = (opts.stdout ?? process.stdout) as NodeJS.WriteStream;
    this.isTTY = !!(this.stdout as { isTTY?: boolean }).isTTY;
    // terminal:false disables readline's echo — fixes the char doubling bug
    this.rl = readline.createInterface({
      input: this.stdin,
      output: this.stdout,
      terminal: false,
    });
    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => this.handleClose());
  }

  isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rl.close();
  }

  /**
   * Print the prompt and await the next line of input. Returns null if
   * stdin closed before the next line arrived.
   *
   * Multiple `nextLine()` consumers are queued: each call returns the
   * next successive line. There is no per-node prompt — the LLM decides
   * what to attack.
   */
  nextLine(): Promise<string | null> {
    if (this.closed) return Promise.resolve(null);
    this.printPrompt();
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }


  /**
   * Print a message in the middle of REPL operation. Does NOT redraw
   * the prompt — the next `nextLine()` call will draw it. This avoids
   * the prompt-doubling bug where both notify and nextLine would
   * print the prompt back-to-back.
   *
   * Safe to call from async callbacks (orchestrator, LLM streamer,
   * finding handler). Always appends a newline so the next prompt
   * (drawn by the caller's next `nextLine()`) appears on its own line.
   */
  notify(text: string): void {
    if (this.closed) return;
    this.stdout.write(text + '\n');
  }

  /** Print text without disrupting any prompt state. Use for banners. */
  print(text: string): void {
    this.stdout.write(text + '\n');
  }

  warn(text: string): void {
    this.notify(`\x1b[33m${text}\x1b[0m`);
  }

  error(text: string): void {
    this.notify(`\x1b[31m${text}\x1b[0m`);
  }

  /** Returns the current line buffer the user is typing. */
  currentBuffer(): string {
    return this.buffer;
  }

  /** Parse a raw line into a structured command. */
  parseLine(line: string): ParsedPromptLine {
    const trimmed = line.trim();
    if (!trimmed) return { kind: 'empty' };
    if (trimmed.startsWith('/')) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
      return { kind: 'slash', cmd, args };
    }
    return { kind: 'command', line: trimmed };
  }

  /** Public dispatch helper: parses the line and routes to callbacks. */
  async dispatch(line: string): Promise<void> {
    const parsed = this.parseLine(line);
    if (parsed.kind === 'empty') return;
    if (parsed.kind === 'closed') return;
    if (parsed.kind === 'slash') {
      try {
        const result = await this.callbacks.onSlash(parsed.cmd, parsed.args);
        if (result) this.notify(result);
      } catch (e) {
        this.notify(`\x1b[31mslash error:\x1b[0m ${(e as Error).message}`);
      }
      return;
    }
    try {
      const result = await this.callbacks.onCommand(parsed.line);
      if (result) this.notify(result);
    } catch (e) {
      this.notify(`\x1b[31mcommand error:\x1b[0m ${(e as Error).message}`);
    }
  }

  private printPrompt(): void {
    if (!this.isTTY) return;
    this.stdout.write(PROMPT_STR);
  }

  private handleLine(rawLine: string): void {
    if (this.closed) {
      // Stale line after close — drop
      return;
    }
    // Clear the prompt we printed + the buffer the user just finished.
    // In non-TTY mode, rawLine is whatever the user typed (no echo). In
    // TTY mode, readline's `terminal:false` means it never echoed, so
    // the line we see is exactly what was typed. The prompt we wrote
    // stays on the terminal until the next notify/print overwrites it.
    this.buffer = '';
    const resolver = this.resolvers.shift();
    resolver?.(rawLine);
  }

  private handleClose(): void {
    this.closed = true;
    // Resolve all pending consumers with null so they can exit cleanly
    while (this.resolvers.length > 0) {
      const r = this.resolvers.shift();
      r?.(null);
    }
  }
}

export const SLASH_HELP = `
Slash commands:
  /help            this message
  /quit            exit the hunt (Ctrl+C also works)
  /open <url>      navigate the browser to <url> (or reopen last URL if no <url>)
  /goto <url>      alias for /open
  /nav <url>       alias for /open
  /test            generate Playwright tests from findings
  /report          render the HTML report now
  /add <url>       add a URL to the workflow graph

Free-form commands (driven by interactive session):
  go <url>             navigate the browser to <url>
  click <selector>     click an element
  type <sel> <value>   fill an input
  attack <url> [t]     run LLM attack against <url>
  findings             list current findings
  status               show hunt status
`.trim();
