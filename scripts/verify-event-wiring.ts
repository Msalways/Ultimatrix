// scripts/verify-event-wiring.ts
// Connects to the running web UI, kicks off a hunt, and prints every
// event type received. Verifies that onComposerEvent flows through
// the orchestrator → huntWorkerRunner → Composer → server → WS.

import { WebSocket } from 'ws';
import * as http from 'http';

const port = parseInt(process.argv[2] ?? '62398', 10);
const target = process.argv[3] ?? 'https://xss-game.appspot.com/level1/frame';
const maxRuntimeMs = parseInt(process.argv[4] ?? '90000', 10);

const eventCounts = new Map<string, number>();
const sampleEvents: Array<{ type: string; payload: unknown }> = [];

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
ws.on('open', () => {
  console.log(`[verify] connected to ws://127.0.0.1:${port}/ws`);
  ws.send(JSON.stringify({ type: 'start', target, outputDir: './output-events-e2e', maxRuntimeMs }));
  console.log(`[verify] sent start → ${target} (maxRuntimeMs=${maxRuntimeMs})`);
});

ws.on('message', (raw: Buffer) => {
  let ev: any;
  try { ev = JSON.parse(raw.toString()); } catch { return; }
  const t = String(ev.type ?? 'unknown');
  eventCounts.set(t, (eventCounts.get(t) ?? 0) + 1);
  if (sampleEvents.length < 4 || t === 'finding' || t === 'plan' || t === 'specialist') {
    sampleEvents.push({ type: t, payload: ev });
  }
  process.stdout.write(`.${t.slice(0, 3)}`);
  if (t === 'done' || t === 'error') {
    console.log('\n[verify] hunt ended:', ev.type, ev.message ?? '(no error)');
    console.log('\n[verify] Event counts:');
    for (const [k, v] of [...eventCounts.entries()].sort()) {
      console.log(`  ${k.padEnd(18)} ${v}`);
    }
    console.log('\n[verify] Sample events:');
    for (const s of sampleEvents.slice(0, 6)) {
      console.log(`  [${s.type}] ${JSON.stringify(s.payload).slice(0, 220)}`);
    }
    const required = ['started', 'done'];
    const missing = required.filter((r) => !eventCounts.has(r));
    const newEvents = ['plan', 'primitive', 'finding'].filter((e) => eventCounts.has(e));
    console.log(`\n[verify] lifecycle OK: ${missing.length === 0 ? 'YES' : 'MISSING ' + missing.join(',')}`);
    console.log(`[verify] new onComposerEvent events present: ${newEvents.length > 0 ? newEvents.join(',') : 'NONE (LLM may have been mock)'}`);
    process.exit(missing.length === 0 ? 0 : 1);
  }
});

ws.on('error', (e: Error) => {
  console.error('[verify] ws error:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('\n[verify] timeout — killing ws');
  ws.terminate();
  console.log('[verify] Event counts:');
  for (const [k, v] of [...eventCounts.entries()].sort()) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
  process.exit(2);
}, maxRuntimeMs + 15000).unref();
