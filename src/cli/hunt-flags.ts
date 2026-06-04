// src/cli/hunt-flags.ts
//
// Pure option parser for the `hunt` command. Extracted from hunt.ts so it
// can be unit-tested without pulling in the orchestrator and browser deps.
//
// Flag surface (intentionally small):
//   -t, --target <url>          Target URL (required)
//   -o, --output <dir>          Output directory (default ./output)
//   --mode <auto|guided>        Run mode (default guided)
//   --skip <list>               Comma-separated phases to skip:
//                                 spider,recon,chains,tests (default none)
//   --depth <n>                 Spider depth (default 2)
//   --max-runtime <seconds>     Hard time limit (default 1800)
//   --seed-url <url>            Extra URL to seed the workflow graph (repeatable)
//   --existing-model <path>     Skip spider, load this app-model.json

export interface HuntOptions {
  target: string;
  outputDir: string;
  mode: 'guided' | 'auto';
  skip: Set<'spider' | 'recon' | 'chains' | 'tests'>;
  depth: number;
  maxRuntimeMs: number;
  existingModelPath?: string;
  seedUrls?: string[];
}

const VALID_SKIP = new Set(['spider', 'recon', 'chains', 'tests'] as const);

export function parseHuntFlags(args: string[]): HuntOptions {
  const opts: HuntOptions = {
    target: '',
    outputDir: './output',
    mode: 'guided',
    skip: new Set(),
    depth: 2,
    maxRuntimeMs: 1_800_000,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target') opts.target = args[++i];
    else if (a === '-o' || a === '--output') opts.outputDir = args[++i];
    else if (a === '--mode') {
      const v = args[++i];
      if (v !== 'auto' && v !== 'guided') {
        throw new Error(`--mode must be 'auto' or 'guided', got '${v}'`);
      }
      opts.mode = v;
    }
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
