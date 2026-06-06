// tests/cli/interactive-session.test.ts
import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/cli/interactive-session';

describe('parseCommand — manual shortcuts', () => {
  it('parses "go <url>" as go command', () => {
    expect(parseCommand('go https://example.com/page?x=1')).toEqual({ kind: 'go', url: 'https://example.com/page?x=1' });
  });

  it('parses "navigate" and "nav" aliases as go', () => {
    expect(parseCommand('navigate /foo')).toEqual({ kind: 'go', url: '/foo' });
    expect(parseCommand('nav /bar')).toEqual({ kind: 'go', url: '/bar' });
  });

  it('parses "click <selector>"', () => {
    expect(parseCommand('click button.submit')).toEqual({ kind: 'click', selector: 'button.submit' });
  });

  it('parses "type <selector> <value>" joining spaces in the value', () => {
    expect(parseCommand('type #q hello world there')).toEqual({ kind: 'type', selector: '#q', value: 'hello world there' });
  });

  it('parses "fill" alias as type', () => {
    expect(parseCommand('fill input[name=email] a@b.com')).toEqual({ kind: 'type', selector: 'input[name=email]', value: 'a@b.com' });
  });

  it('parses "attack <url> [technique]"', () => {
    expect(parseCommand('attack https://x.com/y')).toEqual({ kind: 'attack', url: 'https://x.com/y', technique: undefined });
    expect(parseCommand('attack /level1/frame xss')).toEqual({ kind: 'attack', url: '/level1/frame', technique: 'xss' });
  });

  it('parses "findings", "help", "status" as no-arg commands', () => {
    expect(parseCommand('findings').kind).toBe('findings');
    expect(parseCommand('help').kind).toBe('help');
    expect(parseCommand('?').kind).toBe('help');
    expect(parseCommand('status').kind).toBe('status');
  });
});

describe('parseCommand — chat fallback (free-form text)', () => {
  it('treats "hi" as chat', () => {
    expect(parseCommand('hi')).toEqual({ kind: 'chat', message: 'hi' });
  });

  it('treats natural language as chat', () => {
    expect(parseCommand('what are you doing now')).toEqual({ kind: 'chat', message: 'what are you doing now' });
  });

  it('treats "attack this thing" (no URL) as chat', () => {
    expect(parseCommand('attack this thing')).toEqual({ kind: 'chat', message: 'attack this thing' });
  });

  it('treats "go" alone (no URL) as chat', () => {
    expect(parseCommand('go')).toEqual({ kind: 'chat', message: 'go' });
  });

  it('treats "click" alone (no selector) as chat', () => {
    expect(parseCommand('click')).toEqual({ kind: 'chat', message: 'click' });
  });

  it('treats "type #q" (no value) as chat', () => {
    expect(parseCommand('type #q')).toEqual({ kind: 'chat', message: 'type #q' });
  });

  it('treats unknown verbs as chat', () => {
    expect(parseCommand('wat')).toEqual({ kind: 'chat', message: 'wat' });
    expect(parseCommand('explain the XSS finding')).toEqual({ kind: 'chat', message: 'explain the XSS finding' });
  });

  it('preserves the original text in chat.message (no case folding)', () => {
    const p = parseCommand('Hello, Agent!');
    if (p.kind === 'chat') expect(p.message).toBe('Hello, Agent!');
  });
});

describe('parseCommand — slash commands and empty', () => {
  it('parses "/help" as slash', () => {
    expect(parseCommand('/help')).toEqual({ kind: 'slash', cmd: 'help', args: [] });
  });

  it('parses "/add <url>" as slash with args', () => {
    expect(parseCommand('/add https://x.com')).toEqual({ kind: 'slash', cmd: 'add', args: ['https://x.com'] });
  });

  it('parses "/autotest on" as slash', () => {
    expect(parseCommand('/autotest on')).toEqual({ kind: 'slash', cmd: 'autotest', args: ['on'] });
  });

  it('treats empty lines as empty', () => {
    expect(parseCommand('').kind).toBe('empty');
    expect(parseCommand('   ').kind).toBe('empty');
  });
});
