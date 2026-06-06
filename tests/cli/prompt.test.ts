// tests/cli/prompt.test.ts
//
// Tests for the HuntPrompt REPL. The big regression target is the
// character-doubling bug: the previous readline-based REPL echoed typed
// characters on top of the prompt string, so "g" appeared twice. The fix
// uses readline in `terminal: false` mode plus an explicit prompt print
// that the test verifies does NOT contain echoed input.
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import { HuntPrompt, SLASH_HELP, type ParsedPromptLine } from '../../src/cli/prompt';

function makePrompt(opts: { callbacks: any; stdout?: PassThrough; stdin?: PassThrough } = { callbacks: defaultCallbacks() }) {
  const stdout = opts.stdout ?? new PassThrough();
  const stdin = opts.stdin ?? new PassThrough();
  // Force non-TTY: pass output stream that has isTTY = false
  Object.defineProperty(stdout, 'isTTY', { value: false, configurable: true });
  Object.defineProperty(stdin, 'isTTY', { value: false, configurable: true });
  const prompt = new HuntPrompt(opts.callbacks, { stdin: stdin as any, stdout: stdout as any });
  // For tests, manually call nextLine() to get the promise, then write
  // the line to stdin, then wait for resolution.
  return { prompt, stdin, stdout };
}

function defaultCallbacks() {
  return {
    onCommand: async (_line: string) => null,
    onSlash: async (_cmd: string, _args: string[]) => '',
    onQuit: async () => {},
  };
}

async function typeLine(stdin: PassThrough, line: string): Promise<void> {
  // Mimic what readline does on Enter: emit data with the line + \n
  stdin.write(line + '\n');
  // Let readline's internal `line` event fire
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setImmediate(r));
  }
}

describe('HuntPrompt', () => {
  it('nextLine resolves with the line when stdin emits it', async () => {
    const { prompt, stdin } = makePrompt();
    const linePromise = prompt.nextLine();
    await typeLine(stdin, 'go https://x.com');
    const line = await linePromise;
    expect(line).toBe('go https://x.com');
  });

  it('does NOT echo typed characters (the doubling fix)', async () => {
    // The doubling bug: readline echoed "gg" when the user typed "g"
    // because the prompt also wrote characters. With terminal:false,
    // readline should NOT echo — and the prompt should not produce
    // the typed characters either.
    const { prompt, stdin, stdout } = makePrompt();
    const lines: string[] = [];
    stdout.on('data', (chunk: Buffer) => lines.push(chunk.toString()));
    const linePromise = prompt.nextLine();
    await typeLine(stdin, 'go https://x.com');
    await linePromise;
    // The stdout should NOT contain the user's input text echoed back.
    const output = lines.join('');
    // In non-TTY mode, the prompt should produce no output (notify is the
    // way to print) and readline should not echo. The user's typed text
    // must not appear in the output.
    expect(output).not.toContain('go https://x.com');
    prompt.close();
  });

  it('nextLine returns null when stdin closes', async () => {
    const { prompt, stdin } = makePrompt();
    const linePromise = prompt.nextLine();
    stdin.end();
    const line = await linePromise;
    expect(line).toBeNull();
  });

  it('queues multiple nextLine consumers in order', async () => {
    const { prompt, stdin } = makePrompt();
    const p1 = prompt.nextLine();
    const p2 = prompt.nextLine();
    await typeLine(stdin, 'first');
    const a = await p1;
    await typeLine(stdin, 'second');
    const b = await p2;
    expect(a).toBe('first');
    expect(b).toBe('second');
  });

  it('close() prevents future nextLine from blocking', async () => {
    const { prompt } = makePrompt();
    prompt.close();
    const line = await prompt.nextLine();
    expect(line).toBeNull();
  });

  it('close() resolves all pending nextLine consumers with null', async () => {
    const { prompt, stdin } = makePrompt();
    const p1 = prompt.nextLine();
    const p2 = prompt.nextLine();
    const p3 = prompt.nextLine();
    prompt.close();
    expect(await p1).toBeNull();
    expect(await p2).toBeNull();
    expect(await p3).toBeNull();
  });

  it('parseLine classifies command, slash, and empty', () => {
    const p = new HuntPrompt(defaultCallbacks(), { stdin: new PassThrough(), stdout: new PassThrough() });
    const empty: ParsedPromptLine = p.parseLine('   ');
    expect(empty.kind).toBe('empty');
    const cmd = p.parseLine('go https://x.com');
    expect(cmd.kind).toBe('command');
    const slash = p.parseLine('/help');
    expect(slash.kind).toBe('slash');
    if (slash.kind === 'slash') {
      expect(slash.cmd).toBe('help');
      expect(slash.args).toEqual([]);
    }
    const slashArgs = p.parseLine('/add https://y.com extra');
    if (slashArgs.kind === 'slash') {
      expect(slashArgs.cmd).toBe('add');
      expect(slashArgs.args).toEqual(['https://y.com', 'extra']);
    }
  });

  it('dispatch routes commands to onCommand and slash to onSlash', async () => {
    const seen: Array<{ kind: string; line?: string; cmd?: string; args?: string[] }> = [];
    const callbacks = {
      onCommand: async (line: string) => { seen.push({ kind: 'command', line }); return 'cmd-ok'; },
      onSlash: async (cmd: string, args: string[]) => { seen.push({ kind: 'slash', cmd, args }); return 'slash-ok'; },
      onQuit: async () => {},
    };
    const { prompt, stdout } = makePrompt({ callbacks });
    const lines: string[] = [];
    stdout.on('data', (c: Buffer) => lines.push(c.toString()));
    await prompt.dispatch('attack /x y');
    await prompt.dispatch('/help');
    expect(seen[0]).toEqual({ kind: 'command', line: 'attack /x y' });
    expect(seen[1]).toEqual({ kind: 'slash', cmd: 'help', args: [] });
  });

  it('dispatch routes empty lines to nothing', async () => {
    let called = false;
    const callbacks = {
      onCommand: async () => { called = true; return null; },
      onSlash: async () => { called = true; return ''; },
      onQuit: async () => {},
    };
    const { prompt } = makePrompt({ callbacks });
    await prompt.dispatch('   ');
    expect(called).toBe(false);
  });

  it('dispatch surfaces command errors via onCommand handler — caught by dispatcher', async () => {
    const callbacks = {
      onCommand: async () => { throw new Error('boom'); },
      onSlash: async () => '',
      onQuit: async () => {},
    };
    const { prompt, stdout } = makePrompt({ callbacks });
    const lines: string[] = [];
    stdout.on('data', (c: Buffer) => lines.push(c.toString()));
    // dispatch catches the error and notifies
    await prompt.dispatch('go x');
    await waitFor(() => lines.join('').includes('boom'));
    expect(lines.join('')).toContain('boom');
  });

  it('notify writes text + newline (in TTY or non-TTY)', async () => {
    const { prompt, stdout } = makePrompt();
    const lines: string[] = [];
    stdout.on('data', (c: Buffer) => lines.push(c.toString()));
    prompt.notify('hello');
    expect(lines.join('')).toContain('hello');
    expect(lines.join('')).toContain('\n');
  });

  it('notify does NOT redraw the prompt (the doubling-fix)', async () => {
    // Regression: previously notify would re-print the prompt at the
    // end, and then nextLine would print it again, causing the user
    // to see "hunt> hunt>" between commands. notify should now just
    // emit the text and a newline; the prompt redraw is the caller's
    // job (via nextLine).
    const { prompt, stdout } = makePrompt();
    const lines: string[] = [];
    stdout.on('data', (c: Buffer) => lines.push(c.toString()));
    prompt.notify('! unknown command');
    const out = lines.join('');
    expect(out).not.toContain('hunt>');
    expect(out.trim()).toBe('! unknown command');
  });

  it('warn and error prefix with ANSI color codes', () => {
    const { prompt, stdout } = makePrompt();
    const lines: string[] = [];
    stdout.on('data', (c: Buffer) => lines.push(c.toString()));
    prompt.warn('careful');
    prompt.error('bad');
    const out = lines.join('');
    expect(out).toContain('\x1b[33m'); // yellow for warn
    expect(out).toContain('\x1b[31m'); // red for error
  });

  it('isClosed reports state correctly', () => {
    const { prompt } = makePrompt();
    expect(prompt.isClosed()).toBe(false);
    prompt.close();
    expect(prompt.isClosed()).toBe(true);
  });

  it('SLASH_HELP is non-empty and contains the core commands', () => {
    expect(SLASH_HELP).toContain('/help');
    expect(SLASH_HELP).toContain('/quit');
    expect(SLASH_HELP).toContain('/test');
  });
});
