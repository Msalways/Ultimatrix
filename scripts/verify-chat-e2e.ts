// scripts/verify-chat-e2e.ts
//
// End-to-end verification of the chat coordinator with the real LLM.
// Runs a couple of chat turns and prints the responses. Useful as a
// smoke test after wiring a new provider.
//
// Usage:  npx tsx scripts/verify-chat-e2e.ts
import { callChat, type ChatContext, type ChatResponse, type ChatObservation } from '../src/cli/chat-coordinator';
import { getDefaultLLMClient } from '../src/llm/client';

async function main() {
  const llm = getDefaultLLMClient();
  console.log(`provider: ${llm.isReal() ? 'real' : 'mock'}`);

  const baseContext: ChatContext = {
    target: 'https://xss-game.appspot.com',
    currentUrl: 'https://xss-game.appspot.com/level1/frame',
    findings: [],
    recording: [],
    formsOnPage: [
      {
        index: 0,
        action: 'https://xss-game.appspot.com/level1/frame',
        method: 'GET',
        fields: [{ name: 'query', type: 'text', required: true, placeholder: 'Search' }],
      },
    ],
    history: [],
    autotest: true,
  };

  console.log('\n--- turn 1: greeting ---');
  const r1: ChatResponse = await callChat(llm, 'hi, what are you doing?', baseContext);
  console.log('text:', r1.text);
  console.log('plan:', r1.plan.map((a) => a.kind).join(' → ') || '(none)');

  console.log('\n--- turn 2: ask for status with chat history ---');
  const r2: ChatResponse = await callChat(
    llm,
    'ok and what should we do?',
    { ...baseContext, history: [{ role: 'user', text: 'hi, what are you doing?' }, { role: 'assistant', text: r1.text }] },
  );
  console.log('text:', r2.text);
  console.log('plan:', r2.plan.map((a) => a.kind).join(' → ') || '(none)');

  console.log('\n--- turn 3: form auto-test trigger ---');
  const r3: ChatResponse = await callChat(
    llm,
    '[form auto-test trigger] new form on /level1/frame with 1 field',
    { ...baseContext, triggerForm: baseContext.formsOnPage[0] },
  );
  console.log('text:', r3.text);
  console.log('plan:', r3.plan.map((a) => `${a.kind}${a.kind === 'attack' ? `(${a.technique})` : ''}`).join(' → ') || '(none)');

  console.log('\n--- turn 4: ask to scan for interactive elements ---');
  const r4: ChatResponse = await callChat(llm, 'check for interactive elements on the page', baseContext);
  console.log('text:', r4.text);
  console.log('plan:', r4.plan.map((a) => a.kind).join(' → ') || '(none)');

  console.log('\n--- turn 5: ask to navigate ---');
  const r5: ChatResponse = await callChat(llm, 'go to /level2', baseContext);
  console.log('text:', r5.text);
  console.log('plan:', r5.plan.map((a) => a.kind).join(' → ') || '(none)');

  console.log('\n--- turn 6: summary turn (LLM summarises observations) ---');
  const observations: ChatObservation[] = [
    {
      action: 'scanInteractive',
      summary: 'found 2 buttons, 1 input, 0 links, 0 clickable on the page',
      data: { buttons: [{ text: 'Search', selector: 'button' }, { text: 'Submit', selector: 'input[type=submit]' }], links: [], inputs: [{ name: 'query', type: 'text' }], clickable: [] },
    },
  ];
  const r6: ChatResponse = await callChat(llm, '(ignored — summary turn)', { ...baseContext, observations });
  console.log('text:', r6.text);
  console.log('plan:', r6.plan.map((a) => a.kind).join(' → ') || '(none)');

  console.log('\n[ok]');
}

main().catch((e) => {
  console.error('failed:', e);
  process.exit(1);
});
