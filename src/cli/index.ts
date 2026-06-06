import { Command, Option } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { select, input, confirm, password } from '@inquirer/prompts';
import { providerRegistry, type ProviderConfig } from '../providers/provider-registry';
import { toolRegistry } from '../tools/tool-registry';
import { readAppModel, writeAppModel, type AppModel } from '../core/app-model';
import type { LLMProviderName, ScanTarget } from '../core/types';
import yaml from 'js-yaml';
import { Logger, colors } from './logger';

const log = new Logger();

function hasAnyConfig(): boolean {
  const searchPaths = [
    path.join(process.cwd(), 'ultimatrix.yaml'),
    path.join(process.cwd(), 'ultimatrix.json'),
    path.join(os.homedir(), '.config', 'ultimatrix', 'providers.yaml'),
    path.join(os.homedir(), '.config', 'ultimatrix', 'config.yaml'),
  ];
  for (const p of searchPaths) {
    if (fs.existsSync(p)) return true;
  }
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.AWS_ACCESS_KEY_ID
  );
}

const program = new Command();

program
  .name('ultimatrix')
  .description('AI-powered security testing')
  .version('2.0.0');

// ── hunt: canonical combined flow (assess + interact + test) ──
program
  .command('hunt')
  .description('Canonical hunt — spider + recon + multi-session RBAC testing + chains + Playwright tests (replaces assess/interact/test)')
  .option('-t, --target <url>', 'Target URL (required)')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--skip <list>', 'Comma-separated phases to skip: spider,recon,chains,tests')
  .option('--depth <n>', 'Spider depth', '2')
  .option('--max-runtime <seconds>', 'Hard time limit', '1800')
  .option('--existing-model <path>', 'Skip spider, load this app-model.json')
  .option('--seed-urls <urls...>', 'Extra URLs to seed the workflow graph (relative to target origin)')
  .action(async (opts) => {
    const { parseHuntFlags, runHunt } = await import('./hunt');
    const seedUrls: string[] = opts.seedUrls ? (Array.isArray(opts.seedUrls) ? opts.seedUrls : [opts.seedUrls]) : [];
    const extra: string[] = [];
    for (const u of seedUrls) extra.push('--seed-url', u);
    const huntOpts = parseHuntFlags([
      '-t', opts.target || '',
      '-o', opts.output,
      opts.skip ? '--skip' : '',
      opts.skip || '',
      '--depth', opts.depth,
      '--max-runtime', opts.maxRuntime,
      opts.existingModel ? '--existing-model' : '',
      opts.existingModel || '',
      ...extra,
    ].filter((x) => x !== '' && x !== null && x !== undefined));
    await runHunt(huntOpts);
  });

// ── assess: deprecated alias for hunt ──
program
  .command('assess')
  .description('[DEPRECATED] Use `hunt` instead. Security assessment — agent explores, records, and tests the target.')
  .option('-t, --target <url>', 'Target URL')
  .option('-o, --output <dir>', 'Output directory')
  .option('--headless', 'Run browser in headless mode (visible by default)')
  .option('--provider <provider>', 'LLM provider (or set env var like OPENAI_API_KEY)')
  .option('--model <model>', 'Model ID')
  .option('--dry-run', 'Validate config and target, then exit')
  .option('--dashboard', 'Start live WebSocket dashboard')
  .addOption(new Option('--depth <n>', 'Crawl depth').default('2').hideHelp())
  .addOption(new Option('--with-openapi <path>', 'Pre-populate from OpenAPI spec').hideHelp())
  .addOption(new Option('--with-har <path>', 'Pre-populate from HAR file').hideHelp())
  .addOption(new Option('--with-postman <path>', 'Pre-populate from Postman collection').hideHelp())
  .addOption(new Option('--with-src <path>', 'Pre-populate from source code').hideHelp())
  .addOption(new Option('--max-calls <n>', 'Tool call limit').default('50').hideHelp())
  .addOption(new Option('--keep-browser', 'Keep browser open').hideHelp())
  .addOption(new Option('--fresh', 'Delete previous output and re-crawl from scratch').hideHelp())
  .addOption(new Option('--v3', 'Use the workflow-DAG-driven orchestrator (AutonomousV3) with multi-session RBAC').hideHelp())
  .addOption(new Option('--max-runtime <seconds>', 'Max runtime in seconds for v3 orchestrator').default('1800').hideHelp())
  .addOption(new Option('--max-concurrency <n>', 'v3: max parallel workers (default 4)').default('4').hideHelp())
  .addOption(new Option('--sleep-between-nodes <ms>', 'v3: delay between dispatching nodes (default 0)').default('0').hideHelp())
  .addOption(new Option('--cookies-from <file>', 'v3: Playwright storage state JSON to pre-inject into default session').hideHelp())
  .addOption(new Option('--no-concurrency', 'v3: disable parallel workers (sequential only)').hideHelp())
  .action(async (opts) => {
    log.warn('`assess` is deprecated. Use `ultimatrix hunt -t <url>` instead.');
    const config = await loadRuntimeConfig({ ...opts });
    const target = (opts.target || config.scan?.target || '').replace(/\/$/, '');
    if (!target) { log.error('No target specified. Use -t <url> or set scan.target in ultimatrix.yaml'); process.exit(1); }
    const outDir = path.resolve(opts.output || config.output?.dir || './output');
    if (opts.fresh && fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
      log.dim('Cleaned output directory (--fresh)');
    }
    fs.mkdirSync(outDir, { recursive: true });
    const appModelPath = path.join(outDir, 'app-model.json');
    const { setAppModelPath } = await import('../core/app-model-path');
    setAppModelPath(appModelPath);
    if (opts.dryRun) {
      log.header('Dry Run', 'Validating configuration');
      log.info(`Target: ${target}`);
      log.info(`Output: ${outDir}`);
      try {
        const mgr = (await import('../tools/browser-tools')).getSharedBrowserManager(!opts.headless);
        await mgr.getOrCreate('default');
        log.success('Browser: OK');
        const page = await mgr.getOrCreate('default');
        await page.goto(target, { timeout: 10000 });
        log.success(`Target reachable: ${target}`);
        await mgr.closeAll();
      } catch (e) {
        log.warn(`Target check: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await (await import('../oast')).ensureOastRunning();
        log.success('OAST server: OK');
      } catch {
        log.warn('OAST server: could not start');
      }
      log.success('Dry run complete. All checks passed.');
      process.exit(0);
    }
    let initialModel: Partial<import('../core/app-model').AppModel> = {};
    if (opts.withOpenapi || opts.withHar || opts.withPostman || opts.withSrc) {
      const { ingestAll } = await import('../ingestion');
      initialModel = ingestAll({
        openapi: opts.withOpenapi,
        har: opts.withHar,
        postman: opts.withPostman,
        sourceDir: opts.withSrc,
      }, target);
    }
    if (Object.keys(initialModel).length > 0) {
      const { DEFAULT_MODEL } = await import('../core/app-model');
      const model: AppModel = {
        ...DEFAULT_MODEL, target,
        techStack: initialModel.techStack || [],
        auth: { type: 'unknown' as const, loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {} },
        workflow: { nodes: [], edges: [] },
        endpoints: initialModel.endpoints || [], forms: initialModel.forms || [], scripts: [],
        cookies: initialModel.cookies || {}, localStorage: {}, findings: [], verifications: [],
        parameterClassifications: [], authBoundaries: [], recordedSessions: {},
        hypotheses: initialModel.hypotheses || [], nextSteps: initialModel.nextSteps || [],
        visitedUrls: initialModel.visitedUrls || [], oastCallbacks: [], coverage: [],
      };
      writeAppModel(appModelPath, model);
    }
    if (opts.v3) {
      const { parseHuntFlags, runHunt } = await import('./hunt');
      const huntOpts = parseHuntFlags(['-t', target, '-o', outDir, '--max-runtime', String(opts.maxRuntime), '--no-tests']);
      await runHunt(huntOpts);
      return;
    }
    // v1 fallback: REPL-based orchestrator
    const chatModel = await loadModel(config);
    const ac = new AbortController();
    const { AutonomousOrchestrator } = await import('../pipeline/autonomous');
    const orchestrator = new AutonomousOrchestrator({
      model: chatModel,
      target: { url: target } as ScanTarget,
      outputDir: outDir,
      format: config.output?.format || 'html',
      appModelPath,
      maxToolCalls: opts.maxCalls ? parseInt(opts.maxCalls, 10) : undefined,
      keepBrowser: opts.keepBrowser || undefined,
      abortSignal: ac.signal,
    });
    const result = await orchestrator.run();
    if (fs.existsSync(result.reportPath)) {
      log.success(`Assessment complete. Report: ${result.reportPath}`);
    } else {
      log.warn('Assessment finished but no report file was generated.');
    }
    process.exit(0);
  });

// ── tools: List security tools ──
program
  .command('tools')
  .description('List security testing tools')
  .option('-c, --category <category>', 'Filter by category')
  .action((opts) => {
    if (opts.category) {
      const tools = toolRegistry.getByCategory(opts.category);
      for (const tool of tools) log.dim(`  ${tool.name}: ${tool.description}`);
    } else {
      const byCategory = toolRegistry.listByCategory();
      for (const [category, names] of Object.entries(byCategory)) {
        log.info(category);
        for (const name of names) log.dim(`  ${name}`);
      }
    }
  });

// ── interact: Live REPL chat loop ──
program
  .command('interact')
  .description('Live REPL chat loop with the autonomous agent. Type /record start for manual browser recording.')
  .option('-t, --target <url>', 'Target URL')
  .action(async (opts) => {
    log.warn('`interact` is deprecated. Use `ultimatrix hunt -t <url> --guided` instead.');
    const config = await loadRuntimeConfig({ ...opts });
    const model = await loadModel(config);
    const { startRepl } = await import('./repl');
    await startRepl({
      model,
      targetUrl: opts.target || '',
      outputDir: config.output?.dir || './output',
    });
  });

// ── test: Generate Playwright tests from recorded browser sessions ──
program
  .command('test')
  .description('Generate Playwright tests from recorded browser sessions')
  .option('-s, --session <id>', 'Session ID', 'default')
  .option('-o, --output <dir>', 'Output directory', './playwright-tests')
  .option('--name <name>', 'Workflow name', 'Recorded Workflow')
  .action(async (opts) => {
    const { BrowserSessionManager } = await import('../core/browser-session');
    const { PlaywrightTestGenerator } = await import('../tools/test-generator');
    const mgr = new BrowserSessionManager(false);
    const steps = mgr.getRecording(opts.session);
    if (steps.length === 0) {
      log.error(`No recording found for session "${opts.session}".`);
      log.info('Use the browser recording tools via REPL or agent to record actions first.');
      log.info('  ultimatrix interact -t <url>  — then call browser_start_recording, navigate, click, fill, generate_playwright_test');
      process.exit(1);
    }

    const target = steps.find(s => s.url)?.url || 'http://localhost:3000';
    const manifest = {
      target,
      roles: [{ name: 'default', credentials: {} }],
      workflows: [{
        name: opts.name,
        test: {
          happy: steps.map(s => {
            switch (s.type) {
              case 'navigate': return `NAV|${s.url}`;
              case 'click': return `CLI|${s.selector}`;
              case 'fill': return `FIL|${s.selector}|${s.value}`;
              default: return `${s.type}: ${JSON.stringify(s)}`;
            }
          }),
          sad: [],
        },
      }],
    };

    const generator = new PlaywrightTestGenerator(target);
    const outDir = path.join(opts.output, opts.name.toLowerCase().replace(/[^a-z0-9]/g, '-'));
    fs.mkdirSync(outDir, { recursive: true });
    const generated = generator.generateFromManifest(manifest as any, outDir);

    log.success(`Generated ${generated.length} Playwright test files:`);
    for (const f of generated) log.dim(`  ${f}`);
  });

// ── verify: Re-run findings against a new deployment ──
program
  .command('verify')
  .description('Re-run previous findings against a new target deployment to check which vulnerabilities are fixed')
  .option('-a, --app-model <path>', 'Path to existing app-model.json from a previous assessment')
  .option('-t, --target <url>', 'New target URL to verify against')
  .option('-o, --output <dir>', 'Output directory', './verify-output')
  .option('--timeout <ms>', 'Request timeout in ms', '10000')
  .action(async (opts) => {
    if (!opts.appModel || !opts.target) {
      log.error('Both --app-model and --target are required.');
      log.info('  ultimatrix verify -a ./assess-output/app-model.json -t https://new-deployment.com');
      process.exit(1);
    }
    const outDir = path.resolve(opts.output);
    fs.mkdirSync(outDir, { recursive: true });
    log.header('Verification', `Re-running findings against ${opts.target}`);

    const { verifyFindings } = await import('../verification');
    const result = await verifyFindings(opts.appModel, opts.target, outDir, { timeout: parseInt(opts.timeout, 10) || 10000 });

    log.divider();
    log.header('Results', `${result.summary.total} findings verified`);
    log.info(`  ${result.summary.fixed} fixed`);
    log.info(`  ${result.summary.regressed} regressed`);
    log.info(`  ${result.summary.unchanged} unchanged`);

    if (result.summary.regressed > 0) {
      log.warn(`⚠️ ${result.summary.regressed} finding(s) regressed. Check verified-findings.json for details.`);
    }
    log.dim(`Full results: ${path.join(outDir, 'verified-findings.json')}`);
    process.exit(result.summary.regressed > 0 ? 1 : 0);
  });

program
  .command('web')
  .description('start the local web UI for the hunt')
  .option('-p, --port <port>', 'port to listen on', process.env.PORT ?? '3000')
  .option('-h, --host <host>', 'host to bind', process.env.HOST ?? '0.0.0.0')
  .action(async (opts) => {
    const { startWebServer } = await import('../web/server');
    const port = parseInt(opts.port, 10);
    const { port: actual } = await startWebServer({ port, host: opts.host });
    console.log(`\n\x1b[1;32m▸ Ultimatrix web UI\x1b[0m`);
    console.log(`  listening on http://localhost:${actual}`);
    console.log(`  open the URL in a browser, then click \x1b[1mStart hunt\x1b[0m\n`);
  });

program.parse();

if (process.argv.length <= 2) {
  // No subcommand provided — print help so the user knows what to run
  console.log('\x1b[1;32m▸ Ultimatrix\x1b[0m — AI security researcher\n');
  console.log('Quick start:');
  console.log('  npx ultimatrix hunt -t https://target.com            # canonical full hunt (spider + recon + attack + tests)');
  console.log('  npx ultimatrix hunt -t https://target.com --auto    # autonomous (no prompts)');
  console.log('  npx ultimatrix hunt -t https://target.com --guided  # step-by-step (default)');
  console.log('  npx ultimatrix web                                   # local web UI on :3000');
  console.log('  npx ultimatrix demo                                  # run vulnerable demo target on :4567');
  console.log('  npx ultimatrix setup                                 # configure LLM providers\n');
  console.log('Run \x1b[1multimatrix --help\x1b[0m for all commands.');
  process.exit(0);
}

// ── Core helpers ──

function providerEnvVar(provider: string): string {
  const map: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    'azure-openai': 'AZURE_OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    groq: 'GROQ_API_KEY',
    gemini: 'GEMINI_API_KEY',
    together: 'TOGETHER_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
  };
  return map[provider] || 'API_KEY';
}

function providerQuestions(provider: string): Array<{ field: string; question: string; default?: string; secret?: boolean }> {
  const common = [
    { field: 'name', question: 'Model ID', default: 'gpt-4o' },
  ];
  if (provider === 'azure-openai') {
    return [
      { field: 'apiKey', question: 'Azure API Key', secret: true },
      { field: 'endpoint', question: 'Azure endpoint (https://xxx.openai.azure.com)' },
      { field: 'apiVersion', question: 'API version', default: '2024-02-01' },
      ...common,
    ];
  }
  if (provider === 'bedrock') {
    return [
      { field: 'auth', question: 'Auth method (accessKey/iamRole/apiKey)', default: 'accessKey' },
      { field: 'accessKeyId', question: 'AWS Access Key ID' },
      { field: 'secretAccessKey', question: 'AWS Secret Access Key', secret: true },
      { field: 'region', question: 'AWS Region', default: 'us-east-1' },
      ...common,
    ];
  }
  if (provider === 'nvidia') {
    return [
      { field: 'apiKey', question: 'NVIDIA API Key', secret: true },
      { field: 'baseURL', question: 'Base URL (optional for self-hosted)' },
      ...common,
    ];
  }
  return [
    { field: 'apiKey', question: `API Key (or set ${providerEnvVar(provider)})`, secret: true },
    ...common,
  ];
}

async function loadRuntimeConfig(cliOpts?: Record<string, string>): Promise<{ provider: { name: string; [key: string]: any }; scan: { target?: string; headless?: boolean; timeout?: number }; output: { dir: string; format: string } }> {
  const config: any = { provider: {}, scan: {}, output: { dir: './output', format: 'html' } };

  // 1. Global config
  const globalConfigPath = path.join(os.homedir(), '.config', 'ultimatrix', 'config.yaml');
  if (fs.existsSync(globalConfigPath)) {
    try {
      const yamlContent = fs.readFileSync(globalConfigPath, 'utf-8');
      if (yamlContent.trim()) {
        const parsed = yaml.load(yamlContent);
        if (parsed) Object.assign(config, deepMerge(config, parsed));
      }
    } catch {}
  }

  // 2. Project config file
  for (const p of [path.join(process.cwd(), 'ultimatrix.yaml'), path.join(process.cwd(), 'ultimatrix.json')]) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf-8');
        let parsed: any;
        if (p.endsWith('.yaml') || p.endsWith('.yml')) {
          parsed = yaml.load(content);
        } else {
          parsed = JSON.parse(content);
        }
        if (parsed) {
          // Support old flat format: {"provider": "openai", "model": "gpt-4o", "target": "..."}
          if (typeof parsed.provider === 'string') {
            parsed = {
              provider: { name: parsed.provider, model: parsed.model },
              scan: { target: parsed.target, headless: parsed.headless, harPath: parsed.har },
              output: { dir: parsed.output, format: parsed.format || 'html' },
            };
          }
          Object.assign(config, deepMerge(config, parsed));
        }
      } catch {}
      break;
    }
  }

  // 3. Providers file (secrets)
  const providersPath = path.join(os.homedir(), '.config', 'ultimatrix', 'providers.yaml');
  if (fs.existsSync(providersPath)) {
    try {
      const parsed = yaml.load(fs.readFileSync(providersPath, 'utf-8')) as Record<string, any>;
      if (parsed && config.provider?.name && parsed[config.provider.name]) {
        Object.assign(config.provider, parsed[config.provider.name]);
      }
    } catch {}
  }

  // Normalize: if provider is a string, convert to object
  if (typeof config.provider === 'string') {
    config.provider = { name: config.provider };
  }

  // 4. CLI overrides
  if (cliOpts?.provider) config.provider.name = cliOpts.provider;
  if (cliOpts?.model) config.provider.model = cliOpts.model;
  if (cliOpts?.target) config.scan.target = cliOpts.target;
  if (cliOpts?.output) config.output.dir = cliOpts.output;
  if (cliOpts?.format) config.output.format = cliOpts.format;

  // 5. Env var fallbacks
  if (!config.provider.name) {
    const envProviders: Record<string, string> = {
      OPENAI_API_KEY: 'openai',
      OPENROUTER_API_KEY: 'openrouter',
      ANTHROPIC_API_KEY: 'anthropic',
      AZURE_OPENAI_API_KEY: 'azure-openai',
      GROQ_API_KEY: 'groq',
      GEMINI_API_KEY: 'gemini',
      AWS_ACCESS_KEY_ID: 'bedrock',
    };
    for (const [envKey, providerName] of Object.entries(envProviders)) {
      if (process.env[envKey]) {
        config.provider.name = providerName;
        break;
      }
    }
  }
  if (!config.provider.apiKey && config.provider.name) {
    const envKey = providerEnvVar(config.provider.name);
    if (process.env[envKey]) config.provider.apiKey = process.env[envKey];
  }

  return config;
}

async function loadModel(config: any) {
  const providerName = config.provider?.name;
  const apiKey = config.provider?.apiKey;
  const modelId = config.provider?.model || 'gpt-4o';

  if (!providerName && !apiKey) {
    throw new Error(
      'No LLM provider configured. Run "ultimatrix init" to set up your API keys, ' +
      'or set an environment variable like OPENAI_API_KEY or NVIDIA_API_KEY.'
    );
  }
  if (!providerName) {
    throw new Error(
      'Provider name not found in ultimatrix.yaml or env vars. ' +
      'Run "ultimatrix init" or set a provider env var like OPENAI_API_KEY.'
    );
  }
  if (!apiKey) {
    const providersPath = path.join(os.homedir(), '.config', 'ultimatrix', 'providers.yaml');
    if (fs.existsSync(providersPath)) {
      throw new Error(
        `providers.yaml found at ${providersPath} but no apiKey entry for provider '${providerName}'. ` +
        `Run "ultimatrix init" to reconfigure, or set ${providerEnvVar(providerName)} env var.`
      );
    }
    throw new Error(
      `No apiKey for provider '${providerName}'. ` +
      `Set ${providerEnvVar(providerName)} env var or run "ultimatrix init".`
    );
  }

  const { setLlmConfig } = await import('../core/app-model-path');
  setLlmConfig({ provider: providerName, apiKey, model: modelId });

  return providerRegistry.create(providerName as LLMProviderName, {
    apiKey,
    modelId,
    azureEndpoint: config.provider?.endpoint,
    azureApiVersion: config.provider?.apiVersion,
    accessKeyId: config.provider?.accessKeyId,
    secretAccessKey: config.provider?.secretAccessKey,
    region: config.provider?.region,
    baseURL: config.provider?.baseURL,
    temperature: config.provider?.temperature,
  } as ProviderConfig);
}

async function runInit() {
  log.header('Ultimatrix Setup', '');

  const provider = await select({
    message: 'LLM Provider',
    choices: [
      { name: 'OpenAI', value: 'openai' },
      { name: 'Azure OpenAI', value: 'azure-openai' },
      { name: 'OpenRouter (multi-model)', value: 'openrouter' },
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'AWS Bedrock', value: 'bedrock' },
      { name: 'Google Gemini', value: 'gemini' },
      { name: 'Groq', value: 'groq' },
      { name: 'Together AI', value: 'together' },
      { name: 'Mistral AI', value: 'mistral' },
      { name: 'NVIDIA NIM', value: 'nvidia' },
    ],
  });

  const questions = providerQuestions(provider);
  const providerConfig: Record<string, string> = {};

  for (const q of questions) {
    const value = q.secret
      ? await password({ message: q.question, mask: true })
      : q.default
        ? await input({ message: q.question, default: q.default })
        : await input({ message: q.question });
    if (value) providerConfig[q.field] = value;
  }

  const target = await input({ message: 'Default target URL (optional)' });
  const output = await input({ message: 'Output directory', default: './output' });
  const saveSecrets = await confirm({ message: 'Save API keys to ~/.config$1ultimatrix$1providers.yaml?', default: true });

  // Write ultimatrix.yaml (project config — no secrets or meta fields)
  const secretsFields = new Set(['apiKey', 'secretAccessKey', 'accessKeyId', 'auth']);
  const modelLine = providerConfig.name ? `  model: ${providerConfig.name}\n` : '';
  const extraLines = Object.entries(providerConfig)
    .filter(([k]) => !secretsFields.has(k) && k !== 'name')
    .map(([k, v]) => `  ${k}: ${v}\n`);
  const ultimatrixYaml = `provider:\n  name: ${provider}\n${modelLine}${extraLines.join('')}scan:\n  target: ${target || ''}\noutput:\n  dir: ${output}\n  format: html\n`;

  fs.writeFileSync(path.join(process.cwd(), 'ultimatrix.yaml'), ultimatrixYaml + '\n');
  log.success('Saved ultimatrix.yaml');

  // Write providers.yaml (secrets — gitignored)
  if (saveSecrets) {
    const secretsDir = path.join(os.homedir(), '.config', 'ultimatrix');
    fs.mkdirSync(secretsDir, { recursive: true });

    let providersData: Record<string, any> = {};
    const existingPath = path.join(secretsDir, 'providers.yaml');
    if (fs.existsSync(existingPath)) {
      try {
        providersData = yaml.load(fs.readFileSync(existingPath, 'utf-8')) as Record<string, any> || {};
      } catch {}
    }

    providersData[provider] = {
      apiKey: providerConfig.apiKey,
      ...(providerConfig.secretAccessKey ? { secretAccessKey: providerConfig.secretAccessKey } : {}),
      ...(providerConfig.accessKeyId ? { accessKeyId: providerConfig.accessKeyId } : {}),
      ...(providerConfig.region ? { region: providerConfig.region } : {}),
    };

    fs.writeFileSync(existingPath, yaml.dump(providersData));
    log.success('Saved API keys to ~/.config/ultimatrix/providers.yaml');
  } else {
    const envVar = providerEnvVar(provider);
    log.warn(`Set ${envVar} env var before running ultimatrix`);
  }

  log.divider();
  log.success('Setup complete. Run \x1b[1multimatrix\x1b[0m to start, or \x1b[1multimatrix assess -t <url>\x1b[0m for assessment');
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
