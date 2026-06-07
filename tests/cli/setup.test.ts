// tests/cli/setup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import {
  readProvidersFile,
  writeProviderEntry,
  writeProjectProvider,
  cleanEntry,
  globalProvidersPath,
  type ProviderEntry,
} from '../../src/cli/setup';

let tmpDir: string;
let providersPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-setup-'));
  providersPath = path.join(tmpDir, 'providers.yaml');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cleanEntry', () => {
  it('strips empty strings and undefined values', () => {
    const cleaned = cleanEntry({ apiKey: 'sk-x', model: '', baseUrl: undefined });
    expect(cleaned).toEqual({ apiKey: 'sk-x' });
  });
  it('preserves whitespace-only fields (treats non-empty as intentional)', () => {
    const cleaned = cleanEntry({ apiKey: 'sk-x', extra: '  ' });
    expect(cleaned).toEqual({ apiKey: 'sk-x', extra: '  ' });
  });
  it('preserves all non-empty fields', () => {
    const cleaned = cleanEntry({ apiKey: 'k', model: 'm', baseUrl: 'https://x' });
    expect(cleaned).toEqual({ apiKey: 'k', model: 'm', baseUrl: 'https://x' });
  });
  it('returns {} when all fields empty', () => {
    expect(cleanEntry({ apiKey: '', model: '', baseUrl: '' })).toEqual({});
  });
});

describe('readProvidersFile', () => {
  it('returns {} when file does not exist', () => {
    expect(readProvidersFile(providersPath)).toEqual({});
  });
  it('returns {} for empty file', () => {
    fs.writeFileSync(providersPath, '');
    expect(readProvidersFile(providersPath)).toEqual({});
  });
  it('returns {} for whitespace-only file', () => {
    fs.writeFileSync(providersPath, '   \n\n  \n');
    expect(readProvidersFile(providersPath)).toEqual({});
  });
  it('returns {} for non-object root (array)', () => {
    fs.writeFileSync(providersPath, yaml.dump([1, 2, 3]));
    expect(readProvidersFile(providersPath)).toEqual({});
  });
  it('returns {} for malformed YAML', () => {
    fs.writeFileSync(providersPath, ':\n  : :\n  [malformed');
    expect(readProvidersFile(providersPath)).toEqual({});
  });
  it('parses valid providers file', () => {
    fs.writeFileSync(providersPath, yaml.dump({ nvidia: { apiKey: 'k' }, openai: { model: 'gpt-4' } }));
    expect(readProvidersFile(providersPath)).toEqual({ nvidia: { apiKey: 'k' }, openai: { model: 'gpt-4' } });
  });
});

describe('writeProviderEntry', () => {
  it('creates the parent directory if missing', () => {
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'providers.yaml');
    writeProviderEntry(deepPath, 'nvidia', { apiKey: 'k' });
    expect(fs.existsSync(deepPath)).toBe(true);
  });
  it('writes a single provider entry to an empty file', () => {
    writeProviderEntry(providersPath, 'nvidia', { apiKey: 'nvapi-x', model: 'openai/gpt-oss-120b' });
    const parsed = yaml.load(fs.readFileSync(providersPath, 'utf-8')) as Record<string, ProviderEntry>;
    expect(parsed.nvidia).toEqual({ apiKey: 'nvapi-x', model: 'openai/gpt-oss-120b' });
  });
  it('merges a new entry without clobbering existing providers', () => {
    fs.writeFileSync(providersPath, yaml.dump({ openai: { apiKey: 'sk-a' } }));
    writeProviderEntry(providersPath, 'nvidia', { apiKey: 'nvapi-y' });
    const parsed = yaml.load(fs.readFileSync(providersPath, 'utf-8')) as Record<string, ProviderEntry>;
    expect(parsed.openai).toEqual({ apiKey: 'sk-a' });
    expect(parsed.nvidia).toEqual({ apiKey: 'nvapi-y' });
  });
  it('merges fields for the same provider — new fields win, old fields preserved', () => {
    writeProviderEntry(providersPath, 'nvidia', { apiKey: 'k1' });
    writeProviderEntry(providersPath, 'nvidia', { model: 'openai/gpt-oss-120b' });
    const parsed = yaml.load(fs.readFileSync(providersPath, 'utf-8')) as Record<string, ProviderEntry>;
    expect(parsed.nvidia).toEqual({ apiKey: 'k1', model: 'openai/gpt-oss-120b' });
  });
  it('new fields overwrite old fields of the same key', () => {
    writeProviderEntry(providersPath, 'openai', { apiKey: 'old', model: 'gpt-3.5' });
    writeProviderEntry(providersPath, 'openai', { apiKey: 'new' });
    const parsed = yaml.load(fs.readFileSync(providersPath, 'utf-8')) as Record<string, ProviderEntry>;
    expect(parsed.openai).toEqual({ apiKey: 'new', model: 'gpt-3.5' });
  });
  it('returns the count of providers in the file', () => {
    const r1 = writeProviderEntry(providersPath, 'nvidia', { apiKey: 'k' });
    expect(r1.written).toBe(1);
    const r2 = writeProviderEntry(providersPath, 'openai', { apiKey: 'k2' });
    expect(r2.written).toBe(2);
  });
  it('includes providers in the returned merged object', () => {
    const r = writeProviderEntry(providersPath, 'nvidia', { apiKey: 'k' });
    expect(r.merged).toEqual({ nvidia: { apiKey: 'k' } });
  });
});

describe('writeProjectProvider', () => {
  it('creates a new file with a provider block', () => {
    const yamlPath = path.join(tmpDir, 'ultimatrix.yaml');
    writeProjectProvider(yamlPath, 'nvidia', { apiKey: 'k', model: 'openai/gpt-oss-120b' });
    const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as { provider: { name: string; apiKey: string; model: string } };
    expect(parsed.provider.name).toBe('nvidia');
    expect(parsed.provider.apiKey).toBe('k');
    expect(parsed.provider.model).toBe('openai/gpt-oss-120b');
  });
  it('preserves existing top-level keys when updating provider', () => {
    const yamlPath = path.join(tmpDir, 'ultimatrix.yaml');
    fs.writeFileSync(yamlPath, yaml.dump({ other: { setting: 'x' }, provider: { name: 'openai' } }));
    writeProjectProvider(yamlPath, 'nvidia', { apiKey: 'k' });
    const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as { other: { setting: string }; provider: { name: string } };
    expect(parsed.other).toEqual({ setting: 'x' });
    expect(parsed.provider.name).toBe('nvidia');
  });
  it('overwrites previous provider block on re-run', () => {
    const yamlPath = path.join(tmpDir, 'ultimatrix.yaml');
    writeProjectProvider(yamlPath, 'openai', { apiKey: 'old' });
    writeProjectProvider(yamlPath, 'nvidia', { apiKey: 'new' });
    const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as { provider: { name: string; apiKey: string } };
    expect(parsed.provider.name).toBe('nvidia');
    expect(parsed.provider.apiKey).toBe('new');
  });
  it('handles a corrupt existing file by starting fresh', () => {
    const yamlPath = path.join(tmpDir, 'ultimatrix.yaml');
    fs.writeFileSync(yamlPath, ':\n  : :\n  broken');
    writeProjectProvider(yamlPath, 'nvidia', { apiKey: 'k' });
    const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as { provider: { name: string } };
    expect(parsed.provider.name).toBe('nvidia');
  });
});

describe('globalProvidersPath', () => {
  it('returns ~/.config/ultimatrix/providers.yaml', () => {
    const expected = path.join(os.homedir(), '.config', 'ultimatrix', 'providers.yaml');
    expect(globalProvidersPath()).toBe(expected);
  });
  it('ends in providers.yaml', () => {
    expect(globalProvidersPath().endsWith('providers.yaml')).toBe(true);
  });
});
