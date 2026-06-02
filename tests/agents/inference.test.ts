import { describe, it, expect } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  classifyParamLLM,
  detectBodyFormatLLM,
  detectWafLLM,
  isClickDangerousLLM,
  isClickDangerousByHeuristics,
  detectBodyFormatByHeuristics,
  detectWafByHeaders,
  classifyParamByKeywords,
} from '../../src/agents/inference';

class FakeLLM {
  public responses: string[];
  public callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async invoke(_messages: any[]): Promise<any> {
    const r = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return { content: r };
  }
}

const brokenLLM = {
  invoke: async () => { throw new Error('network down'); },
} as unknown as BaseChatModel;

describe('classifyParamLLM', () => {
  it('parses LLM JSON response', async () => {
    const llm = new FakeLLM([
      '{"category": "id", "attackHints": ["IDOR probe", "boundary test"], "reasoning": "numeric path param"}',
    ]) as unknown as BaseChatModel;

    const r = await classifyParamLLM({ name: 'userId' }, { method: 'GET', path: '/users/:id' }, llm);
    expect(r.source).toBe('llm');
    expect(r.category).toBe('id');
    expect(r.attackHints).toContain('IDOR probe');
  });

  it('handles LLM response wrapped in prose', async () => {
    const llm = new FakeLLM([
      'Sure, here is the classification:\n{"category": "search", "attackHints": [], "reasoning": "free text"}\nDone.',
    ]) as unknown as BaseChatModel;

    const r = await classifyParamLLM({ name: 'q' }, undefined, llm);
    expect(r.category).toBe('search');
  });

  it('falls back to keyword when LLM throws', async () => {
    const r = await classifyParamLLM({ name: 'userId' }, undefined, brokenLLM);
    expect(r.source).toBe('fallback');
    expect(r.category).toBe('id');
  });

  it('falls back to keyword when no LLM provided', async () => {
    const r = await classifyParamLLM({ name: 'email' });
    expect(r.source).toBe('fallback');
    expect(r.category).toBe('email');
  });

  it('returns unknown for ambiguous names', async () => {
    const r = await classifyParamLLM({ name: 'foo' });
    expect(r.category).toBe('unknown');
  });

  it('keyword fallback handles all 13 categories', () => {
    expect(classifyParamByKeywords('email')).toBe('email');
    expect(classifyParamByKeywords('password')).toBe('password');
    expect(classifyParamByKeywords('q')).toBe('search');
    expect(classifyParamByKeywords('redirect')).toBe('redirect');
    expect(classifyParamByKeywords('url')).toBe('url');
    expect(classifyParamByKeywords('token')).toBe('token');
    expect(classifyParamByKeywords('price')).toBe('price');
    expect(classifyParamByKeywords('quantity')).toBe('quantity');
    expect(classifyParamByKeywords('firstName')).toBe('name');
    expect(classifyParamByKeywords('dateOfBirth')).toBe('date');
    expect(classifyParamByKeywords('file')).toBe('file');
    expect(classifyParamByKeywords('userId')).toBe('id');
    expect(classifyParamByKeywords('random')).toBe('unknown');
  });
});

describe('detectBodyFormatLLM', () => {
  it('parses LLM JSON response', async () => {
    const llm = new FakeLLM([
      '{"format": "graphql", "fields": [{"name": "user", "type": "object"}], "reasoning": "query keyword"}',
    ]) as unknown as BaseChatModel;

    const r = await detectBodyFormatLLM('query { user { id } }', 'text/plain', llm);
    expect(r.format).toBe('graphql');
    expect(r.fields[0].name).toBe('user');
  });

  it('falls back to JSON detection for JSON body', async () => {
    const r = await detectBodyFormatLLM('{"a":1}', 'application/json');
    expect(r.format).toBe('json');
    expect(r.fields[0].name).toBe('a');
  });

  it('falls back to XML detection', () => {
    const r = detectBodyFormatByHeuristics('<?xml version="1.0"?><root><a/></root>', 'application/xml');
    expect(r.format).toBe('xml');
  });

  it('falls back to GraphQL by signature', () => {
    const r = detectBodyFormatByHeuristics('query User { id }', 'text/plain');
    expect(r.format).toBe('graphql');
  });

  it('falls back to HTML for doctype', () => {
    const r = detectBodyFormatByHeuristics('<!DOCTYPE html><html></html>', 'text/html');
    expect(r.format).toBe('html');
  });

  it('falls back to binary for octet-stream', () => {
    const r = detectBodyFormatByHeuristics('binarydata', 'application/octet-stream');
    expect(r.format).toBe('binary');
  });

  it('returns text for plain text', () => {
    const r = detectBodyFormatByHeuristics('just plain text', 'text/plain');
    expect(r.format).toBe('text');
  });

  it('uses fallback for very large bodies (no LLM call)', async () => {
    const bigBody = 'x'.repeat(15_000);
    const r = await detectBodyFormatLLM(bigBody, 'text/plain', new FakeLLM(['NEVER CALLED']) as unknown as BaseChatModel);
    expect(r.format).toBe('text');
  });

  it('LLM error returns fallback result', async () => {
    const r = await detectBodyFormatLLM('{"a":1}', 'application/json', brokenLLM);
    expect(r.format).toBe('json');
    expect(r.error).toContain('network down');
  });
});

describe('detectWafLLM', () => {
  it('identifies Cloudflare via cf-ray header', async () => {
    const r = detectWafByHeaders({ 'cf-ray': 'abc123' }, '');
    expect(r.waf).toBe('cloudflare');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('identifies Akamai via x-akamai-*', () => {
    const r = detectWafByHeaders({ 'x-akamai-request-id': '123' }, '');
    expect(r.waf).toBe('akamai');
  });

  it('identifies AWS WAF', () => {
    const r = detectWafByHeaders({ 'x-amzn-waf-action': 'block' }, '');
    expect(r.waf).toBe('aws-waf');
  });

  it('returns none when no signals', () => {
    const r = detectWafByHeaders({ 'content-type': 'text/html' }, '');
    expect(r.waf).toBe('none');
  });

  it('parses LLM response with bypassHints', async () => {
    const llm = new FakeLLM([
      '{"waf": "cloudflare", "confidence": 0.95, "evidence": ["cf-ray header"], "bypassHints": ["unicode normalization", "path encoding"], "reasoning": "Cloudflare from headers and response timing"}',
    ]) as unknown as BaseChatModel;

    const r = await detectWafLLM(403, { 'cf-ray': 'abc' }, '<html>blocked</html>', llm);
    expect(r.source).toBe('llm');
    expect(r.waf).toBe('cloudflare');
    expect(r.bypassHints).toContain('path encoding');
    expect(r.confidence).toBe(0.95);
  });

  it('skips LLM for non-blocked responses', async () => {
    const llm = new FakeLLM(['NEVER CALLED']) as unknown as BaseChatModel;
    const r = await detectWafLLM(200, {}, 'ok', llm);
    expect(r.waf).toBe('none');
  });

  it('LLM error returns fallback', async () => {
    const r = await detectWafLLM(403, { 'cf-ray': 'abc' }, '', brokenLLM);
    expect(r.waf).toBe('cloudflare');
    expect(r.error).toContain('network down');
  });
});

describe('isClickDangerousLLM', () => {
  it('heuristic: safe element is safe', () => {
    const r = isClickDangerousByHeuristics({ tag: 'a', text: 'View Profile' });
    expect(r.safe).toBe(true);
  });

  it('heuristic: delete button is dangerous', () => {
    const r = isClickDangerousByHeuristics({ tag: 'button', text: 'Delete Account' });
    expect(r.safe).toBe(false);
  });

  it('heuristic: cancel in safe context is safe', () => {
    const r = isClickDangerousByHeuristics({ tag: 'button', text: 'Cancel' });
    expect(r.safe).toBe(false);
  });

  it('heuristic: ambiguous defaults to safe', () => {
    const r = isClickDangerousByHeuristics({ tag: 'div', text: 'Click here' });
    expect(r.safe).toBe(true);
    expect(r.confidence).toBe(0.5);
  });

  it('parses LLM response for context-aware assessment', async () => {
    const llm = new FakeLLM([
      '{"safe": false, "confidence": 0.9, "reason": "Delete Account is irreversible"}',
    ]) as unknown as BaseChatModel;

    const r = await isClickDangerousLLM(
      { tag: 'button', text: 'Delete Account', context: 'Account settings' },
      llm,
    );
    expect(r.source).toBe('llm');
    expect(r.safe).toBe(false);
  });

  it('LLM can override heuristic: Cancel in dialog is safe', async () => {
    const llm = new FakeLLM([
      '{"safe": true, "confidence": 0.85, "reason": "Cancel in a dialog closes the modal, no side effect"}',
    ]) as unknown as BaseChatModel;

    const r = await isClickDangerousLLM(
      { tag: 'button', text: 'Cancel', context: 'modal dialog' },
      llm,
    );
    expect(r.safe).toBe(true);
  });

  it('LLM error returns fallback', async () => {
    const r = await isClickDangerousLLM(
      { tag: 'button', text: 'Delete' },
      brokenLLM,
    );
    expect(r.source).toBe('fallback');
    expect(r.safe).toBe(false);
  });
});
