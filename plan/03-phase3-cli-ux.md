# Phase 3: CLI UX Overhaul - Specification

## Overview
Make CLI discoverable, guided, and provide feedback during long operations.

## Tasks

### 3.1 Command Examples in Help (HIGH)

**File:** `src/cli/index.ts`

**Current:** Basic help text, no examples

**Target:**
```
Ultimatrix - Intelligence-Augmented Security Research

Usage: ultimatrix <command> [options]

Core Commands:
  interact -t <url>              Interactive research session
  solve -t <url>                 Autonomous assessment
  scan -t <url>                  Quick scan + report
  assess -t <url>                Full assessment pipeline
  verify -t <url>                Re-check findings

Analysis & Operations:
  report -t <url> [--format]     Export findings
  verify -t <url>                Recheck findings
  replay [-o <dir>]              Replay generated tests
  resume -t <url>                Resume persisted session

Utilities:
  models                         Manage models & capabilities
  budget                         View token/model call budgets
  ratelimit                      View rate limit status
  tools                          Profile tool token usage
  skills                         Manage imported skills
  config                         View/validate configuration

Examples:
  ultimatrix interact -t https://app.example.com
    # Interactive research session

  ultimatrix solve -t https://app.example.com
    # Autonomous assessment

  ultimatrix scan -t https://api.example.com -o ./results
  ultimatrix scan -t https://api.example.com -o ./results --format markdown

  ultimatrix models capability nvidia/nemotron-3-ultra --context 128000 --max-output 8192
  ultimatrix models tier balanced openai/gpt-4o

  ultimatrix budget status
  ultimatrix budget history ./output/target/forensic.ndjson

  ultimatrix ratelimit status
  ultimatrix ratelimit sync

  ultimatrix config doctor
  ultimatrix config path

Global Options:
  -t, --target <url>        Target URL
  -o, --output <dir>        Output directory
  --approve-origin <url>    Pre-approve origin (repeatable)
  -h, --help                Show help
  -v, --version             Show version
```

**Implementation:**
```typescript
// In printCliHelp():
const EXAMPLES = `
Examples:
  ultimatrix interact -t https://app.example.com
    # Interactive research session

  ultimatrix solve -t https://app.example.com
    # Autonomous assessment

  ultimatrix scan -t https://api.example.com -o ./results
  ultimatrix scan -t https://api.example.com -o ./results --format markdown

  ultimatrix models capability nvidia/nemotron-3-ultra --context 128000 --max-output 8192
  ultimatrix models tier balanced openai/gpt-4o

  ultimatrix budget status
  ultimatrix budget history ./output/target/forensic.ndjson

  ultimatrix ratelimit status
  ultimatrix ratelimit sync

  ultimatrix config doctor
  ultimatrix config path
`;

// Add to help output
```

---

### 3.2 Interactive Help in REPL (HIGH)

**File:** `src/session.ts`

**Current:** No `/help` command

**Implementation:**
```typescript
// In runREPL loop:
if (line.trim() === '/help') {
  const helpText = [
    'Commands:',
    '  /help              Show this help',
    '  /brief             Show engagement briefing',
    '  /learned           Show cross-session learning',
    '  /reasoning (/r)    Toggle last turn reasoning',
    '  /clear             Clear terminal',
    '  /status            Show session status',
    '  /budget            Show budget status',
    '  /quit /exit        End session',
    '',
    'Capabilities:',
    '  Browser automation, crawling, vulnerability testing,',
    '  worker spawning, finding verification, reporting.',
    '',
    'Type your goal to begin, or /help for this message.',
  ].join('\n');
  sink?.printHelp(helpText);
  return;
}
```

---

### 3.3 History Navigation (↑/↓) - HIGH

**File:** `src/session.ts` - `runREPL`

**Current:** Basic readline, no history

**Implementation:**
```typescript
const readline = require('readline');
const history = [];
let historyIndex = -1;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  historySize: 100,
  prompt: '> ',
  completer: (line) => {
    const commands = ['/help', '/brief', '/learned', '/reasoning', '/clear', '/status', '/budget', '/quit'];
    const hits = commands.filter(c => c.startsWith(line));
    return [hits.length ? hits : commands, line];
  }
});

rl.on('line', async (line) => {
  history.push(line);
  historyIndex = history.length;
  // ... process line
});

// Handle up/down arrows
process.stdin.on('keypress', (str, key) => {
  if (key.name === 'up' && historyIndex > 0) {
    historyIndex--;
    rl.line = history[historyIndex];
    rl.cursor = history[historyIndex].length;
    rl._refreshLine();
  } else if (key.name === 'down' && historyIndex < history.length - 1) {
    historyIndex++;
    rl.line = history[historyIndex] || '';
    rl.cursor = history[historyIndex]?.length || 0;
    rl._refreshLine();
  }
});
```

---

### 3.4 Progress Spinners for Long Operations

**Files:** `src/cli/solve.ts`, `src/cli/scan.ts`, `src/cli/assess.ts`

**Current:** Silent during long operations

**Implementation:**
```typescript
// Spinner utility
function spinner(text: string) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${frames[i++ % frames.length]} ${text}`);
  }, 80);
  return { stop: () => { clearInterval(interval); process.stdout.write('\r\x1b[K'); } };
}

// In solveCommand:
const spinner = spinner('Initializing assessment...');
const result = await runtime.run(async () => { ... });
spinner.stop();
```

---

### 3.3 Command Completion Hints

**File:** `src/cli/index.ts`

```typescript
// Add tab completion hints to help
log.dim('\nTip: Use tab for command completion (if shell supports it)');
log.dim('      Use ↑/↓ arrows for history in interactive mode');
```

---

### 3.4 Interactive Mode Help (/help)

**Already covered in 3.2** - same implementation.

---

### 3.5 Friendly CLI Errors

**File:** `src/cli/index.ts`

**Current:** Raw error messages

**Implementation:**
```typescript
.catch((err) => {
  let message = err instanceof Error ? err.message : String(err);
  
  // Friendly transformations
  if (message.includes('ECONNREFUSED')) {
    message = `Cannot connect to target. Check URL and network.`;
  } else if (message.includes('ENOTFOUND')) {
    message = `Cannot resolve hostname. Check DNS or URL.`;
  } else if (message.includes('401') || message.includes('403')) {
    message = `Authentication failed. Check credentials.`;
  } else if (message.includes('rate limit') || message.includes('quota')) {
    message = `Rate limit exceeded. Run 'ultimatrix ratelimit status' for details.`;
  }
  
  log.error(message);
  process.exit(1);
});
```

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Help shows examples | ⬜ |
| `/help` works in REPL | ⬜ |
| History navigation (↑/↓) works | ⬜ |
| Progress spinners for long ops | ⬜ |
| Friendly CLI errors | ⬜ |
| `/help` in interactive mode | ⬜ |
| All 2226 tests pass | ⬜ |
| Clean TypeScript build | ⬜ |
| Clean build (ESM, CJS, DTS) | ⬜ |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/cli/index.ts` | Add examples, friendly errors |
| `src/session.ts` | REPL history, /help command |
| `src/cli/solve.ts` | Progress spinner |
| `src/cli/scan.ts` | Progress spinner |
| `src/cli/assess.ts` | Progress spinner |
| `src/cli/verify.ts` | Progress spinner |

---

## Test Plan

- [ ] `ultimatrix --help` shows examples
- [ ] `ultimatrix interact -t <url>` then `/help` works
- [ ] History navigation (↑/↓) works in REPL
- [ ] `ultimatrix solve -t <url>` shows spinner
- [ ] Invalid command shows friendly error
- [ ] All 2226 tests pass
- [ ] Clean TypeScript build
- [ ] Clean build (ESM, CJS, DTS)