// src/cli/interactive-session.ts
//
// The interactive hunt session: a single, unified CLI experience that
// pairs a headed Playwright browser with a terminal REPL.
//
//   hunt -t https://target.com
//
// What happens:
//   1. A headed browser opens pointing at the target
//   2. Manual recording starts — the user's clicks/inputs/navigations
//      are captured for a Playwright user-flow spec
//   3. A terminal REPL appears. The user can:
//        - Type manual shortcuts: go <url>, click <sel>, type <sel> <val>,
//          attack <url> [t], findings, status, /help, /quit, etc.
//        - Type free-form chat: anything that doesn't look like a
//          manual command becomes a chat message to the LLM. The LLM
//          replies and may include a multi-step plan of actions that
//          the session executes (navigate, attack, fill form, etc.).
//   4. Every 1.5s the session scans the current page for new forms.
//      If a NEW form appears AND auto-test is on, the session sends
//      the LLM a "form auto-test trigger" turn — the LLM picks a
//      technique based on the field names/types and dispatches an
//      attack action.
//   5. On exit (Ctrl+C, /quit, stdin close):
//        - Stop recording
//        - Write user-flow.spec.ts
//        - Diff the new endpoints against the existing app-model.json
//          and report created/updated/unchanged
//        - Close the browser
//
// There is no mode flag. The LLM is always running. The user is always
// welcome to chat. Manual commands are fast shortcuts.

import * as fs from 'fs';
import * as path from 'path';
import { BrowserSessionManager } from '../core/browser-session';
import type { MacroStep } from '../core/browser-session';
import { generateUserFlowSpecFromSteps } from '../tools/finding-test-generator';
import { diffEndpoints, applyEndpointDiff, type EndpointDiff } from './endpoint-diff';
import type { AppModel, AppModelEndpoint, AppModelFinding } from '../core/app-model';
import { readAppModel, writeAppModelAsync } from '../core/app-model';
import { HuntPrompt, type HuntPromptCallbacks } from './prompt';
import {
  callChat,
  trimHistory,
  type ChatContext,
  type ChatForm,
  type ChatResponse,
  type ChatMessage,
  type ChatAction,
  type ChatObservation,
  type ChatInteractiveElement,
} from './chat-coordinator';

export interface InteractiveSessionOptions {
  target: string;
  outputDir: string;
  modelPath: string;
  /**
   * Called when the LLM should attack a URL. Returns the number of
   * findings produced. The hunt's main orchestrator may pass a real
   * implementation; tests pass a stub.
   */
  attackCoordinator: (url: string, technique?: string) => Promise<{ findings: number; summary?: string }>;
  /**
   * Called when the user types a free-form chat message (anything
   * that doesn't match a manual command verb with proper args) OR
   * when the session triggers an auto-test on a new form. The chat
   * handler is given the user's message + the current hunt state and
   * returns the LLM's reply (text + optional plan of actions).
   */
  chatCoordinator?: (message: string, context: ChatContext) => Promise<ChatResponse>;
  /**
   * Returns the current findings (used to build ChatContext).
   * Defaults to reading from the model path.
   */
  loadFindings?: () => Promise<AppModelFinding[]>;
  /**
   * Optional callback fired on each new finding so the CLI can print it
   * in real time.
   */
  onFinding?: (finding: { type: string; endpoint: string; severity: string; confidence: number }) => void;
  /**
   * Initial existing endpoints (loaded from app-model.json). Used to
   * detect when a new URL the user visits is actually new vs. known.
   */
  initialEndpoints?: AppModelEndpoint[];
  /**
   * Auto-test new forms: when a new form appears on the page, dispatch
   * a chat turn to the LLM with the form's fields. Default true.
   */
  autotestForms?: boolean;
  /**
   * How often (ms) to scan the current page for new forms. Default 1500.
   */
  formWatchIntervalMs?: number;
}

/**
 * Parse a REPL line. Returns one of:
 *  - structured manual commands (go, click, type, attack, findings, help, status)
 *  - slash commands (/cmd args)
 *  - chat (free-form text — anything that doesn't look like a well-formed manual command)
 *  - empty
 *
 * The heuristic: if the first word is a known manual verb AND the rest
 * is well-formed (right number of args), parse as manual. Otherwise chat.
 */
export type ParsedCommand =
  | { kind: 'go'; url: string }
  | { kind: 'click'; selector: string }
  | { kind: 'type'; selector: string; value: string }
  | { kind: 'attack'; url: string; technique?: string }
  | { kind: 'findings' }
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'slash'; cmd: string; args: string[] }
  | { kind: 'chat'; message: string }
  | { kind: 'empty' };

/**
 * Heuristic: does this string look like a URL we can navigate to?
 * Returns true for absolute URLs, root-relative paths, query-only, hash-only,
 * and bare hostnames with a dot (e.g. "example.com"). Returns false for
 * single words like "this" or "thing" so we route them to chat instead.
 */
function looksLikeUrl(s: string): boolean {
  if (!s) return false;
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('//')) return true;
  if (s.startsWith('/') || s.startsWith('?') || s.startsWith('#')) return true;
  if (s.startsWith('./') || s.startsWith('../')) return true;
  // Bare hostname: must contain a dot and not have spaces
  if (/^[a-z0-9.-]+$/i.test(s) && s.includes('.')) return true;
  return false;
}

/**
 * Heuristic: does this string look like a CSS selector?
 * Returns true for tag names, #id, .class, [attr], tag[attr], and
 * tag.class[attr] forms. Returns false for plain words.
 */
function looksLikeSelector(s: string): boolean {
  if (!s) return false;
  if (s.startsWith('#') || s.startsWith('.') || s.startsWith('[')) return true;
  // tag[attr=value] / tag.class[attr=value] / tag.class
  if (/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*(\[.+?\])?$/i.test(s)) return true;
  return false;
}

export function parseCommand(line: string): ParsedCommand {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'empty' };
  if (trimmed.startsWith('/')) {
    const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
    return { kind: 'slash', cmd, args };
  }
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case 'go':
    case 'navigate':
    case 'nav': {
      if (parts.length < 2 || !looksLikeUrl(parts[1])) return { kind: 'chat', message: trimmed };
      return { kind: 'go', url: parts[1] };
    }
    case 'click': {
      if (parts.length < 2 || !looksLikeSelector(parts[1])) return { kind: 'chat', message: trimmed };
      return { kind: 'click', selector: parts[1] };
    }
    case 'type':
    case 'fill': {
      if (parts.length < 3 || !looksLikeSelector(parts[1])) return { kind: 'chat', message: trimmed };
      return { kind: 'type', selector: parts[1], value: parts.slice(2).join(' ') };
    }
    case 'attack': {
      if (parts.length < 2 || !looksLikeUrl(parts[1])) return { kind: 'chat', message: trimmed };
      return { kind: 'attack', url: parts[1], technique: parts[2] };
    }
    case 'findings':
      return { kind: 'findings' };
    case 'status':
      return { kind: 'status' };
    case 'help':
    case '?':
      return { kind: 'help' };
    default:
      return { kind: 'chat', message: trimmed };
  }
}

export interface InteractiveSessionResult {
  recording: MacroStep[];
  userFlowSpecPath: string | null;
  endpointDiff: EndpointDiff;
  durationMs: number;
  attacks: number;
  findings: number;
  chatTurns: number;
}

/**
 * The interactive session. Owns the browser, the recording, the chat
 * history, the REPL, and the form auto-test watcher.
 */
export class InteractiveHuntSession {
  private browser: BrowserSessionManager;
  private prompt: HuntPrompt | null = null;
  private recording: MacroStep[] = [];
  private knownUrls = new Set<string>();
  private pendingAttacks = new Set<string>();
  private attackCount = 0;
  private findingCount = 0;
  private chatTurnCount = 0;
  private stopped = false;
  private watchedTimers: Array<NodeJS.Timeout> = [];
  private chatHistory: ChatMessage[] = [];
  private autotestForms: boolean;
  private formWatchIntervalMs: number;
  /** The forms we've already auto-tested (by form index on a given URL)
   *  so we don't trigger the same form twice. */
  private seenFormSignatures = new Set<string>();
  /** Last URL the browser was on (used to detect navigation). */
  private lastUrl = '';
  /** Cached current page forms (updated by the watcher). */
  private currentForms: ChatForm[] = [];

  constructor(private opts: InteractiveSessionOptions) {
    this.browser = new BrowserSessionManager(false); // headed
    this.autotestForms = opts.autotestForms ?? true;
    this.formWatchIntervalMs = opts.formWatchIntervalMs ?? 1500;
  }

  /**
   * Start the session: open browser, start recording, run REPL.
   * Returns when the user quits or stdin closes.
   */
  async start(): Promise<InteractiveSessionResult> {
    const startedAt = Date.now();
    const sessionId = 'manual';

    // Seed known URLs from the initial model + target
    for (const ep of this.opts.initialEndpoints ?? []) {
      this.knownUrls.add(this.normalizeUrl(ep.path));
    }
    this.knownUrls.add(this.normalizeUrl(this.opts.target));

    // Open browser and navigate to the target
    console.log(`\n  Opening headed browser → ${this.opts.target}…`);
    try {
      await this.browser.getOrCreate(sessionId, { viewport: { width: 1280, height: 800 } });
      await this.browser.navigate(sessionId, this.opts.target);
      this.lastUrl = this.opts.target;
    } catch (e) {
      console.error(`  ! Failed to open browser: ${(e as Error).message}`);
      return this.buildResult(startedAt);
    }

    // Start manual recording (clicks/inputs in the browser are captured)
    try {
      await this.browser.startManualRecording(sessionId);
      console.log(`  ✓ Manual recording started — interact with the browser.`);
    } catch (e) {
      console.error(`  ! Manual recording failed: ${(e as Error).message}`);
    }

    // Background watcher: every interval, scan for new URLs and new forms
    const watcher = setInterval(() => this.tick().catch(() => {}), this.formWatchIntervalMs);
    this.watchedTimers.push(watcher);

    // Show REPL
    this.printBanner();
    const callbacks: HuntPromptCallbacks = {
      onCommand: async (line) => this.handleFreeFormCommand(line),
      onSlash: async (cmd, args) => this.handleSlashCommand(cmd, args),
      onQuit: async () => { await this.stopAndExit(startedAt); },
    };
    this.prompt = new HuntPrompt(callbacks);

    // Block until stopped
    while (!this.prompt.isClosed() && !this.stopped) {
      const line = await this.prompt.nextLine();
      if (line === null) {
        await this.stopAndExit(startedAt);
        break;
      }
      await this.prompt.dispatch(line);
    }

    return await this.stop(startedAt);
  }

  private async stopAndExit(startedAt: number): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    void this.stop(startedAt).then(() => {
      setImmediate(() => process.exit(0));
    });
  }

  private async handleFreeFormCommand(line: string): Promise<string | null> {
    const cmd = parseCommand(line);
    await this.dispatch(cmd);
    return null;
  }

  private async handleSlashCommand(cmd: string, args: string[]): Promise<string> {
    switch (cmd) {
      case 'test': {
        const { generateFindingTests, writeFindingTests } = await import('../tools/finding-test-generator');
        const m = readAppModel(this.opts.modelPath);
        if (m.findings.length === 0) return 'no findings yet';
        const dir = path.join(this.opts.outputDir, 'playwright-tests');
        const tests = generateFindingTests(m, { outDir: dir, baseUrl: this.opts.target });
        const written = writeFindingTests(tests, dir);
        return `wrote ${written.length} test file(s) to ${dir}`;
      }
      case 'report': {
        const { renderChainFirstReport, renderChainReportHtml } = await import('../core/chain-report');
        const m = readAppModel(this.opts.modelPath);
        const sections = renderChainFirstReport(m);
        const htmlPath = path.join(this.opts.outputDir, 'report.html');
        fs.writeFileSync(htmlPath, renderChainReportHtml(sections), 'utf-8');
        return `Report written to ${htmlPath}`;
      }
      case 'add': {
        const url = args[0];
        if (!url) return 'Usage: /add <url>';
        this.knownUrls.add(this.normalizeUrl(url));
        return `added ${url} to known URLs (will not auto-attack)`;
      }
      case 'open':
      case 'goto':
      case 'nav': {
        // /open <url>    — navigate the browser to <url>
        // /open          — reopen the browser to the last URL it was on
        //                  (this is the "wake the dead session back up"
        //                  command — if you closed the browser window
        //                  by hand, the next primitive call would have
        //                  created a fresh about:blank page; use /open
        //                  to get back to where you were).
        let target = args[0];
        if (!target) {
          const last = this.browser.getLastUrl('manual');
          if (!last) return 'No URL given and no previous navigation to reopen to. Usage: /open <url>';
          target = last;
          this.prompt?.notify(`  ↻ reopening browser at last URL: ${last}`);
        }
        if (!looksLikeUrl(target)) return `Doesn't look like a URL: ${target}. Usage: /open <url>`;
        await this.navigateAndTrack(target, `/${cmd}`);
        // navigateAndTrack already called this.prompt?.notify(...), so
        // there is nothing additional to return here.
        return '';
      }
      case 'autotest': {
        const arg = (args[0] ?? '').toLowerCase();
        if (arg === 'on') {
          this.autotestForms = true;
          return 'auto-test forms: ON — new forms will be auto-tested';
        } else if (arg === 'off') {
          this.autotestForms = false;
          return 'auto-test forms: OFF — chat handles new forms only if you ask';
        }
        return `auto-test is currently ${this.autotestForms ? 'ON' : 'OFF'}. Usage: /autotest on|off`;
      }
      case 'clear': {
        const before = this.chatHistory.length;
        this.chatHistory = [];
        return `cleared ${before} messages from chat history`;
      }
      case 'history': {
        if (this.chatHistory.length === 0) return 'chat history is empty';
        return this.chatHistory
          .map((m) => `  ${m.role === 'user' ? 'you' : 'agent'}: ${m.text}`)
          .join('\n');
      }
      case 'help':
      case '?':
        return [
          'Manual commands:',
          '  go <url>            navigate the browser to <url>',
          '  click <selector>    click an element',
          '  type <sel> <value>  fill an input',
          '  attack <url> [t]    run LLM attack against <url>',
          '  findings            list current findings',
          '  status              show session counters',
          '',
          'Slash commands:',
          '  /open <url>         navigate the browser to <url> (or reopen last URL if no <url>)',
          '  /goto <url>         alias for /open',
          '  /nav <url>          alias for /open',
          '  /test               generate Playwright tests from findings',
          '  /report             render the HTML report',
          '  /add <url>          add a URL to the workflow graph',
          '  /autotest on|off    toggle form auto-test',
          '  /clear              clear chat history',
          '  /history            show last chat messages',
          '  /help               this message',
          '  /quit               exit',
          '',
          'Chat:',
          '  Type anything else and the LLM will respond. The LLM can',
          '  also return a multi-step plan (navigate, attack, fill form)',
          '  that the session executes for you.',
        ].join('\n');
      case 'quit':
      case 'exit':
        await this.stopAndExit(Date.now());
        return 'exiting…';
      default:
        return `unknown slash: /${cmd}. Try /help.`;
    }
  }

  private printBanner(): void {
    console.log('');
    console.log(`  \x1b[1;36m─── interactive session ───\x1b[0m`);
    console.log(`  Browser: headed Playwright pointed at \x1b[4m${this.opts.target}\x1b[0m`);
    console.log(`  Recording: clicks, inputs, and navigations in the browser are captured.`);
    console.log(`  Auto-attack: the LLM attacks each new URL you visit.`);
    console.log(`  Auto-test: ${this.autotestForms ? '\x1b[1;32mON\x1b[0m' : '\x1b[1;31mOFF\x1b[0m'} — new forms are sent to the LLM for testing.`);
    console.log('');
    console.log(`  Type \x1b[1mhelp\x1b[0m or \x1b[1m/?\x1b[0m for the command list, or just chat with the agent.`);
    console.log('');
  }

  /**
   * Single source of truth for "navigate the manual browser to a URL".
   * Both the free-form `go <url>` verb (in dispatch) and the slash forms
   * `/open <url>`, `/goto <url>`, `/nav <url>` (in handleSlashCommand)
   * route through this method so they share the same tracking + form
   * auto-test trigger. The no-arg `/open` form reopens the browser to
   * whatever URL it was last on (the URL remembered by
   * BrowserSessionManager, which survives a manual close).
   */
  private async navigateAndTrack(url: string, source: string): Promise<void> {
    const sessionId = 'manual';
    const finalUrl = await this.browser.navigate(sessionId, url);
    this.prompt?.notify(`  → ${finalUrl}  (via ${source})`);
    this.lastUrl = finalUrl;
    this.checkForNewUrl(finalUrl);
  }

  private async dispatch(cmd: ParsedCommand): Promise<void> {
    const sessionId = 'manual';
    try {
      switch (cmd.kind) {
        case 'go': {
          await this.navigateAndTrack(cmd.url, 'go');
          break;
        }
        case 'click': {
          await this.browser.click(sessionId, cmd.selector);
          this.prompt?.notify(`  ✓ clicked ${cmd.selector}`);
          const url = await this.browser.getCurrentUrl?.(sessionId) ?? null;
          if (url) {
            this.lastUrl = url;
            this.checkForNewUrl(url);
          }
          break;
        }
        case 'type': {
          await this.browser.fill(sessionId, cmd.selector, cmd.value);
          this.prompt?.notify(`  ✓ typed ${JSON.stringify(cmd.value)} into ${cmd.selector}`);
          break;
        }
        case 'attack': {
          const obs = await this.executeAttackObservation(cmd.url, cmd.technique);
          this.prompt?.notify(`  \x1b[2m·\x1b[0m ${obs.summary}`);
          break;
        }
        case 'findings': {
          const all = await this.opts.attackCoordinator('__list_findings__');
          this.prompt?.notify(`  ${all.summary ?? 'no findings'}`);
          break;
        }
        case 'status': {
          this.prompt?.notify(`  attacks: ${this.attackCount}  findings: ${this.findingCount}  pending: ${this.pendingAttacks.size}  known URLs: ${this.knownUrls.size}  chat turns: ${this.chatTurnCount}  autotest: ${this.autotestForms ? 'on' : 'off'}`);
          break;
        }
        case 'help': {
          this.prompt?.notify(await this.handleSlashCommand('help', []));
          break;
        }
        case 'slash': {
          // Route slash commands through handleSlashCommand. (HuntPrompt
          // already calls this, but if a caller invokes dispatch directly
          // with a slash kind, handle it here too.)
          this.prompt?.notify(await this.handleSlashCommand(cmd.cmd, cmd.args));
          break;
        }
        case 'chat': {
          await this.executeChat(cmd.message);
          break;
        }
        case 'empty':
          break;
      }
    } catch (e) {
      this.prompt?.notify(`  ! ${(e as Error).message}`);
    }
  }

  /**
   * Run a chat turn. The LLM is asked to return {text, plan}. The plan
   * is executed; each action's result is captured as an observation.
   * If the plan produced any observations, a follow-up turn sends them
   * back to the LLM so it can summarise the actual outcomes in plain
   * English. The user only ever sees the final text.
   */
  private async executeChat(message: string, triggerForm?: ChatForm): Promise<void> {
    if (!this.opts.chatCoordinator) {
      this.prompt?.notify('  ! chat not configured (no chatCoordinator wired)');
      return;
    }
    this.chatTurnCount++;
    const context = await this.buildChatContext(triggerForm);
    this.chatHistory.push({ role: 'user', text: message });
    let reply: ChatResponse;
    try {
      reply = await this.opts.chatCoordinator(message, context);
    } catch (e) {
      this.prompt?.notify(`  ! chat error: ${(e as Error).message}`);
      return;
    }
    this.chatHistory.push({ role: 'assistant', text: reply.text });
    this.chatHistory = trimHistory(this.chatHistory);

    if (reply.plan.length > 0) {
      this.prompt?.notify(`  \x1b[2m· plan: ${reply.plan.map((a) => a.kind).join(' → ')}\x1b[0m`);
      const observations: ChatObservation[] = [];
      for (const action of reply.plan) {
        const obs = await this.executeAction(action);
        if (obs) {
          observations.push(obs);
          if (obs.data !== undefined) {
            this.prompt?.notify(`    \x1b[2m→ ${obs.summary}\x1b[0m`);
          } else {
            this.prompt?.notify(`    \x1b[2m→ ${obs.summary}\x1b[0m`);
          }
        }
      }
      // If any observation carries data (scans, attacks with results),
      // send them back to the LLM for a final summary turn.
      const dataBearing = observations.filter((o) => o.data !== undefined);
      if (dataBearing.length > 0) {
        const summaryCtx = await this.buildChatContext(triggerForm);
        summaryCtx.observations = dataBearing;
        let summaryReply: ChatResponse;
        try {
          summaryReply = await this.opts.chatCoordinator('(summary turn)', summaryCtx);
        } catch (e) {
          this.prompt?.notify(`  ! summary error: ${(e as Error).message}`);
          return;
        }
        if (summaryReply.text) {
          // Replace the previous assistant text with the summarised one
          if (this.chatHistory.length > 0 && this.chatHistory[this.chatHistory.length - 1].role === 'assistant') {
            this.chatHistory[this.chatHistory.length - 1] = { role: 'assistant', text: summaryReply.text };
            this.chatHistory = trimHistory(this.chatHistory);
          }
          this.prompt?.notify(`\x1b[1;35m  agent ›\x1b[0m ${summaryReply.text}`);
        }
      } else if (reply.text) {
        this.prompt?.notify(`\x1b[1;35m  agent ›\x1b[0m ${reply.text}`);
      }
    } else if (reply.text) {
      this.prompt?.notify(`\x1b[1;35m  agent ›\x1b[0m ${reply.text}`);
    }
  }

  /**
   * Execute a single ChatAction. Returns an observation describing the
   * outcome. The caller passes the observation back to the LLM on the
   * summary turn so it can describe actual results.
   */
  private async executeAction(action: ChatAction): Promise<ChatObservation | null> {
    const sessionId = 'manual';
    try {
      switch (action.kind) {
        case 'attack':
          return await this.executeAttackObservation(action.url, action.technique);
        case 'go': {
          const finalUrl = await this.browser.navigate(sessionId, action.url);
          this.lastUrl = finalUrl;
          this.checkForNewUrl(finalUrl);
          return { action: 'go', summary: `navigated to ${finalUrl}` };
        }
        case 'click':
          await this.browser.click(sessionId, action.selector);
          return { action: 'click', summary: `clicked ${action.selector}` };
        case 'type':
          await this.browser.fill(sessionId, action.selector, action.value);
          return { action: 'type', summary: `typed ${JSON.stringify(action.value)} into ${action.selector}` };
        case 'fillForm': {
          const form = this.currentForms.find((f) => f.index === action.formIndex);
          if (!form) {
            return { action: 'fillForm', summary: `no form with index ${action.formIndex} on the current page` };
          }
          const filled: string[] = [];
          for (const [fieldName, value] of Object.entries(action.values)) {
            const field = form.fields.find((f) => f.name === fieldName);
            if (!field) continue;
            const selector = `[name="${fieldName}"]`;
            await this.browser.fill(sessionId, selector, value);
            filled.push(`${fieldName}="${value}"`);
          }
          if (action.submit) {
            await this.browser.click(sessionId, `form:nth-of-type(${action.formIndex + 1}) button[type="submit"]`)
              .catch(() => this.browser.click(sessionId, `form button[type="submit"]`).catch(() => null));
          }
          return { action: 'fillForm', summary: `filled ${filled.length} field(s)${action.submit ? ' and submitted' : ''}: ${filled.join(', ')}` };
        }
        case 'scanInteractive': {
          const json = await this.browser.extractInteractiveElements(sessionId);
          const parsed = this.parseInteractiveJson(json);
          return {
            action: 'scanInteractive',
            summary: `found ${this.interactiveCount(parsed)} interactive element(s) — ${this.interactiveBreakdown(parsed)}`,
            data: parsed,
          };
        }
        case 'scanForms': {
          const json = await this.browser.extractForms(sessionId);
          const parsed = this.parseFormsJson(json);
          this.currentForms = parsed;
          return {
            action: 'scanForms',
            summary: `found ${parsed.length} form(s) on the page`,
            data: parsed,
          };
        }
        case 'extractLinks': {
          const txt = await this.browser.extractLinks(sessionId);
          const count = (txt.match(/\n/g)?.length ?? 1);
          return {
            action: 'extractLinks',
            summary: `extracted ${count} link(s)`,
            data: txt,
          };
        }
        case 'extractText': {
          const txt = await this.browser.extractText(sessionId);
          const truncated = txt.length > 2000 ? txt.slice(0, 2000) + `\n... (truncated, ${txt.length} chars total)` : txt;
          return {
            action: 'extractText',
            summary: `extracted ${txt.length} char(s) of visible text`,
            data: truncated,
          };
        }
        case 'screenshot': {
          const buf = await this.browser.screenshot(sessionId, action.fullPage ?? false);
          const screenshotDir = path.join(this.opts.outputDir, 'screenshots');
          fs.mkdirSync(screenshotDir, { recursive: true });
          const filename = `screenshot-${Date.now()}.png`;
          const filePath = path.join(screenshotDir, filename);
          fs.writeFileSync(filePath, buf);
          return {
            action: 'screenshot',
            summary: `saved screenshot to ${filePath} (${buf.length} bytes)`,
            data: { path: filePath, bytes: buf.length },
          };
        }
        case 'findings': {
          const all = await this.opts.attackCoordinator('__list_findings__');
          return {
            action: 'findings',
            summary: all.summary ?? 'no findings',
            data: { count: all.findings },
          };
        }
        case 'status':
          return {
            action: 'status',
            summary: `attacks=${this.attackCount} findings=${this.findingCount} pending=${this.pendingAttacks.size} known=${this.knownUrls.size} chat=${this.chatTurnCount}`,
          };
        case 'noop':
          return { action: 'noop', summary: 'no-op' };
      }
    } catch (e) {
      return { action: action.kind, summary: `error: ${(e as Error).message}` };
    }
    return null;
  }

  private parseInteractiveJson(json: string): { buttons: ChatInteractiveElement[]; links: ChatInteractiveElement[]; inputs: ChatInteractiveElement[]; clickable: ChatInteractiveElement[] } {
    try {
      const obj = JSON.parse(json);
      return {
        buttons: Array.isArray(obj.buttons) ? obj.buttons : [],
        links: Array.isArray(obj.links) ? obj.links : [],
        inputs: Array.isArray(obj.inputs) ? obj.inputs : [],
        clickable: Array.isArray(obj.clickable) ? obj.clickable : [],
      };
    } catch {
      return { buttons: [], links: [], inputs: [], clickable: [] };
    }
  }

  private interactiveCount(parsed: { buttons: ChatInteractiveElement[]; links: ChatInteractiveElement[]; inputs: ChatInteractiveElement[]; clickable: ChatInteractiveElement[] }): number {
    return parsed.buttons.length + parsed.links.length + parsed.inputs.length + parsed.clickable.length;
  }

  private interactiveBreakdown(parsed: { buttons: ChatInteractiveElement[]; links: ChatInteractiveElement[]; inputs: ChatInteractiveElement[]; clickable: ChatInteractiveElement[] }): string {
    const parts: string[] = [];
    if (parsed.buttons.length) parts.push(`${parsed.buttons.length} button(s)`);
    if (parsed.inputs.length) parts.push(`${parsed.inputs.length} input(s)`);
    if (parsed.links.length) parts.push(`${parsed.links.length} link(s)`);
    if (parsed.clickable.length) parts.push(`${parsed.clickable.length} clickable(s)`);
    return parts.length > 0 ? parts.join(', ') : 'none';
  }

  /** Attack variant that returns an observation (so the LLM can summarise). */
  private async executeAttackObservation(url: string, technique?: string): Promise<ChatObservation> {
    const norm = this.normalizeUrl(url);
    if (this.pendingAttacks.has(norm)) {
      return { action: 'attack', summary: `attack on ${url} already in flight, skipped` };
    }
    this.pendingAttacks.add(norm);
    try {
      const res = await this.opts.attackCoordinator(url, technique);
      this.attackCount++;
      this.findingCount += res.findings;
      this.pendingAttacks.delete(norm);
      if (res.findings > 0) {
        return {
          action: 'attack',
          summary: `attack on ${url} found ${res.findings} finding(s)${res.summary ? ` — ${res.summary}` : ''}`,
          data: { url, technique, findings: res.findings, summary: res.summary },
        };
      }
      return {
        action: 'attack',
        summary: `attack on ${url} found nothing`,
        data: { url, technique, findings: 0 },
      };
    } catch (e) {
      this.pendingAttacks.delete(norm);
      return { action: 'attack', summary: `attack on ${url} failed: ${(e as Error).message}` };
    }
  }

  /** Build a ChatContext from current session state. */
  private async buildChatContext(triggerForm?: ChatForm): Promise<ChatContext> {
    let findings: AppModelFinding[] = [];
    if (this.opts.loadFindings) {
      findings = await this.opts.loadFindings();
    } else {
      try {
        const m = readAppModel(this.opts.modelPath);
        findings = m.findings ?? [];
      } catch { /* ignore */ }
    }
    return {
      target: this.opts.target,
      currentUrl: this.lastUrl,
      findings,
      recording: this.recording.slice(),
      formsOnPage: this.currentForms.slice(),
      history: this.chatHistory.slice(),
      autotest: this.autotestForms,
      triggerForm,
    };
  }

  /**
   * Watcher tick: scan for new URLs the user touched and new forms on
   * the current page. Auto-dispatch LLM attacks on new URLs. If a new
   * form appears, fire a chat auto-test turn.
   */
  private async tick(): Promise<void> {
    const sessionId = 'manual';

    // 1. Update recording
    const rec = this.browser.getRecording(sessionId) ?? [];
    this.recording = rec;

    // 2. Check for new URLs
    let currentUrl: string | null = null;
    try {
      currentUrl = (await this.browser.getCurrentUrl?.(sessionId)) ?? null;
    } catch { /* ignore */ }
    if (currentUrl && currentUrl !== this.lastUrl) {
      this.lastUrl = currentUrl;
      this.checkForNewUrl(currentUrl);
    }
    for (const step of rec) {
      if (step.type === 'navigate' && step.url) {
        this.checkForNewUrl(step.url);
      }
    }

    // 3. Check for new forms on the current page
    if (this.autotestForms && this.opts.chatCoordinator) {
      try {
        const formsJson = await this.browser.extractForms(sessionId);
        const forms = this.parseFormsJson(formsJson);
        this.currentForms = forms;
        // Detect NEW forms
        for (const form of forms) {
          const sig = this.formSignature(this.lastUrl, form);
          if (this.seenFormSignatures.has(sig)) continue;
          this.seenFormSignatures.add(sig);
          // New form — auto-test
          const actionUrl = form.action || this.lastUrl;
          this.prompt?.notify(`  \x1b[1;36magent noticed new form on ${this.lastUrl}\x1b[0m — asking LLM to test it…`);
          await this.executeChat(
            `[form auto-test trigger] I just detected a new form on ${this.lastUrl} with ${form.fields.length} field(s). Pick a technique and test it.`,
            form,
          );
          // The LLM's plan will likely include an attack action; mark
          // the URL as a known URL so we don't double-attack.
          this.knownUrls.add(this.normalizeUrl(actionUrl));
        }
      } catch (e) {
        // Forms extraction is best-effort; ignore failures
      }
    }
  }

  private formSignature(url: string, form: ChatForm): string {
    const fieldNames = form.fields.map((f) => `${f.name}:${f.type}`).join(',');
    return `${url}::${form.action}::${form.method}::${fieldNames}`;
  }

  private parseFormsJson(json: string): ChatForm[] {
    try {
      const arr = JSON.parse(json) as Array<{ index: number; action: string; method: string; fields: ChatForm['fields'] }>;
      return arr.map((f) => ({
        index: f.index,
        action: f.action,
        method: f.method,
        fields: f.fields ?? [],
      }));
    } catch {
      return [];
    }
  }

  private checkForNewUrl(url: string): void {
    const norm = this.normalizeUrl(url);
    if (this.knownUrls.has(norm)) return;
    if (this.pendingAttacks.has(norm)) return;
    this.knownUrls.add(norm);
    this.pendingAttacks.add(norm);
    this.prompt?.notify(`  \x1b[1;35mnew URL\x1b[0m ${norm} — dispatching LLM attack…`);
    void this.opts.attackCoordinator(norm).then((res) => {
      this.attackCount++;
      this.findingCount += res.findings;
      this.pendingAttacks.delete(norm);
      if (res.findings > 0) {
        this.prompt?.notify(`  \x1b[1;33m+\x1b[0m ${res.findings} finding(s) on ${norm}${res.summary ? ` — ${res.summary}` : ''}`);
      } else {
        this.prompt?.notify(`  \x1b[2m·\x1b[0m attack on ${norm} found nothing`);
      }
    }).catch((e) => {
      this.pendingAttacks.delete(norm);
      this.prompt?.notify(`  ! attack on ${norm} failed: ${(e as Error).message}`);
    });
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * Stop the session: cancel timers, stop recording, generate the
   * user-flow spec, diff endpoints, write back to the model.
   */
  async stop(startedAt: number): Promise<InteractiveSessionResult> {
    if (this.stopped) {
      return this.buildResult(startedAt);
    }
    this.stopped = true;
    for (const t of this.watchedTimers) clearInterval(t);
    this.watchedTimers = [];

    if (this.prompt) { this.prompt.close(); this.prompt = null; }

    let rec: MacroStep[] = [];
    try {
      rec = await this.browser.stopManualRecording('manual');
    } catch { /* best effort */ }
    this.recording = rec;

    let specPath: string | null = null;
    if (rec.length > 0) {
      const file = generateUserFlowSpecFromSteps(rec, this.opts.target, 'manual');
      if (file) {
        const dir = path.join(this.opts.outputDir, 'playwright-tests');
        fs.mkdirSync(dir, { recursive: true });
        specPath = path.join(dir, file.path);
        fs.writeFileSync(specPath, file.content, 'utf-8');
        console.log(`\n  ✓ Recorded ${rec.length} actions → ${specPath}`);
      }
    } else {
      console.log(`\n  · No manual actions recorded.`);
    }

    let endpointDiff: EndpointDiff = { created: [], updated: [], unchanged: [], removed: [] };
    try {
      const existing = this.opts.initialEndpoints ?? [];
      const discovered: AppModelEndpoint[] = (() => {
        const seen = new Set<string>();
        const eps: AppModelEndpoint[] = [];
        for (const step of rec) {
          if (step.type === 'navigate' || step.type === 'click' || step.type === 'fill') {
            const u = step.type === 'navigate' ? step.url : null;
            if (u) {
              const k = this.normalizeUrl(u);
              if (!seen.has(k)) {
                seen.add(k);
                eps.push({ path: u, method: 'GET', params: [], requiresAuth: false, responseStatus: 200, contentType: 'text/html', bodyPreview: '' });
              }
            }
          }
        }
        return eps;
      })();
      endpointDiff = diffEndpoints(existing, discovered);
      const { next, summary } = applyEndpointDiff(existing, endpointDiff);
      console.log(`\n  \x1b[1mEndpoint diff vs app-model.json:\x1b[0m`);
      console.log(summary);
      if (fs.existsSync(this.opts.modelPath) && (endpointDiff.created.length > 0 || endpointDiff.updated.length > 0)) {
        const m = readAppModel(this.opts.modelPath) as AppModel;
        m.endpoints = next as any;
        await writeAppModelAsync(this.opts.modelPath, m);
        console.log(`  ✓ Updated ${this.opts.modelPath}`);
      }
    } catch (e) {
      console.error(`  ! endpoint diff failed: ${(e as Error).message}`);
    }

    try {
      await this.browser.closeAll();
    } catch { /* best effort */ }

    return this.buildResult(startedAt, rec, specPath, endpointDiff);
  }

  private buildResult(
    startedAt: number,
    rec?: MacroStep[],
    specPath: string | null = null,
    endpointDiff?: EndpointDiff,
  ): InteractiveSessionResult {
    return {
      recording: rec ?? this.recording,
      userFlowSpecPath: specPath,
      endpointDiff: endpointDiff ?? { created: [], updated: [], unchanged: [], removed: [] },
      durationMs: Date.now() - startedAt,
      attacks: this.attackCount,
      findings: this.findingCount,
      chatTurns: this.chatTurnCount,
    };
  }
}
