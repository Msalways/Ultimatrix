// src/cli/hunt-flags.ts
//
// Pure option parser for the `hunt` command. Extracted from hunt.ts so it
// can be unit-tested without pulling in the orchestrator and browser deps.

export interface HuntOptions {
  target: string;
  outputDir: string;
  mode: 'guided' | 'auto';
  skipTests: boolean;
  testsDir: string;
  depth: number;
  maxRuntimeMs: number;
  skipChains: boolean;
  skipRecon: boolean;
  skipSpider: boolean;
  forceSpider: boolean;
  existingModelPath?: string;
  seedUrls?: string[];
  maxNodes?: number;
}

export function parseHuntFlags(args: string[]): HuntOptions {
  const opts: HuntOptions = {
    target: '',
    outputDir: './output',
    mode: 'guided',
    skipTests: false,
    testsDir: './playwright-tests',
    depth: 2,
    maxRuntimeMs: 1_800_000,
    skipChains: false,
    skipRecon: false,
    skipSpider: false,
    forceSpider: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t' || a === '--target') opts.target = args[++i];
    else if (a === '-o' || a === '--output') opts.outputDir = args[++i];
    else if (a === '--guided') opts.mode = 'guided';
    else if (a === '--auto') opts.mode = 'auto';
    else if (a === '--no-tests') opts.skipTests = true;
    else if (a === '--tests-dir') opts.testsDir = args[++i];
    else if (a === '--depth') opts.depth = parseInt(args[++i], 10);
    else if (a === '--max-runtime') opts.maxRuntimeMs = parseInt(args[++i], 10) * 1000;
    else if (a === '--no-chains') opts.skipChains = true;
    else if (a === '--no-recon') opts.skipRecon = true;
    else if (a === '--no-spider') opts.skipSpider = true;
    else if (a === '--force-spider') opts.forceSpider = true;
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
