// src/cli/hunt-flags.ts
//
// Pure option parser for the `hunt` command. Extracted from hunt.ts so it
// can be unit-tested without pulling in the orchestrator and browser deps.
//
// Flag surface (intentionally small):
//   -t, --target <url>          Target URL (required)
//   -o, --output <dir>          Output directory (default ./output)
//   --skip <list>               Comma-separated phases to skip:
//                                 spider,recon,chains,tests (default none)
//   --depth <n>                 Spider depth (default 2)
//   --max-runtime <seconds>     Hard time limit (default 1800)
//   --seed-url <url>            Extra URL to seed the workflow graph (repeatable)
//   --existing-model <path>     Skip spider, load this app-model.json
//
// The hunt always runs the LLM attack pipeline. There is no `--mode` flag:
// the LLM decides what to do. A headed browser is opened automatically so
// the user can interact with the target; their manual clicks/inputs are
// recorded and the LLM attacks each URL they touch in parallel.

export interface HuntOptions {
  target: string;
  outputDir: string;
  skip: Set<'spider' | 'recon' | 'chains' | 'tests'>;
  depth: number;
  maxRuntimeMs: number;
  existingModelPath?: string;
  seedUrls?: string[];
  /**
   * Optional sink for LLM token streaming. When set, the Composer
   * forwards every LLM token it receives (label + chunk). The web UI
   * uses this to stream tokens to the browser over WebSocket. For
   * terminal-only streaming, set ULTIMATRIX_LLM_STREAM=1 instead.
   */
  onLLMToken?: (label: string, chunk: string) => void;
  /**
   * Optional sink for structured Composer lifecycle events
   * (plan-proposed, primitive, triage, specialist-spawn, finding,
   * plan-end). The web UI consumes these to render the live plan,
   * primitive timeline, and findings list. Threaded through every
   * worker spawned by the orchestrator.
   */
  onComposerEvent?: (event: import('../agents/composer').ComposerLogEvent) => void;
  /**
   * Optional sink for low-level primitive invocations across all
   * workers. Useful for tests and for the "primitive" UI panel.
   */
  onPrimitive?: (name: string, args: unknown, result: { ok: boolean; error?: string; durationMs: number }) => void;
}

const VALID_SKIP = new Set(['spider', 'recon', 'chains', 'tests'] as const);

export function parseHuntFlags(args: string[]): HuntOptions {
  const opts: HuntOptions = {
    target: '',
    outputDir: './output',
    skip: new Set(),
    depth: 2,
    maxRuntimeMs: 1_800_000,
    seedUrls: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target') opts.target = args[++i];
    else if (a === '-o' || a === '--output') opts.outputDir = args[++i];
    else if (a === '--skip') {
      const list = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const item of list) {
        if (!VALID_SKIP.has(item as any)) {
          throw new Error(
            `--skip: unknown phase '${item}'. Valid: ${Array.from(VALID_SKIP).join(', ')}`,
          );
        }
        opts.skip.add(item as any);
      }
    }
    else if (a === '--depth') opts.depth = parseInt(args[++i], 10);
    else if (a === '--max-runtime') opts.maxRuntimeMs = parseInt(args[++i], 10) * 1000;
    else if (a === '--existing-model') opts.existingModelPath = args[++i];
    else if (a === '--mode') {
      const value = args[++i] ?? '';
      throw new Error(
        `--mode was removed: the hunt is always terminal-driven (LLM + REPL). ` +
        `Got --mode ${value}. Omit the flag and use the prompt at the bottom of the terminal.`,
      );
    }
    else if (a === '--seed-url') {
      if (!opts.seedUrls) opts.seedUrls = [];
      opts.seedUrls.push(args[++i]);
    }
  }
  if (!opts.target) {
    throw new Error('Missing required --target / -t <url>');
  }
  return opts;
}
