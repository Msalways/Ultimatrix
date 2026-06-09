export interface HuntOptions {
  target: string;
  outputDir: string;
  skip: Set<'spider' | 'recon' | 'chains' | 'tests' | 'interactive' | 'observe' | 'learn' | 'attack'>;
  depth: number;
  maxRuntimeMs: number;
  auto: boolean;
  configPath?: string;
  existingModelPath?: string;
  seedUrls?: string[];
  onLLMToken?: (label: string, chunk: string) => void;
  onComposerEvent?: (event: import('../agents/composer').ComposerLogEvent) => void;
  onPrimitive?: (name: string, args: unknown, result: { ok: boolean; error?: string; durationMs: number }) => void;
  onHuntCore?: (core: import('../hunt/core').HuntCore) => void;
}

const VALID_SKIP = new Set([
  'spider', 'recon', 'chains', 'tests', 'interactive',
  'observe', 'learn', 'attack',
] as const);

export function parseHuntFlags(args: string[]): HuntOptions {
  const opts: HuntOptions = {
    target: '',
    outputDir: '',
    skip: new Set(),
    depth: 2,
    maxRuntimeMs: 0,
    auto: false,
    seedUrls: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target') opts.target = args[++i];
    else if (a === '-o' || a === '--output') opts.outputDir = args[++i];
    else if (a === '--config') opts.configPath = args[++i];
    else if (a === '--auto') opts.auto = true;
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
    else if (a === '--no-interactive') opts.skip.add('interactive');
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
  if (opts.auto) opts.skip.add('interactive');
  return opts;
}
