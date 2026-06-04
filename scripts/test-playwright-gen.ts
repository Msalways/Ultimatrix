// scripts/test-playwright-gen.ts
//
// Force some synthetic findings into app-model.json, then call
// generateFindingTests to verify the Playwright test generator works.

import * as fs from 'fs';
import * as path from 'path';
import { readAppModel, writeAppModel } from '../src/core/app-model';
import { generateFindingTests, writeFindingTests } from '../src/tools/finding-test-generator';

const outDir = './output-realtime';
const testsDir = './playwright-tests-realtime';

const modelPath = path.join(outDir, 'app-model.json');
if (!fs.existsSync(modelPath)) {
  console.error(`No app-model.json at ${modelPath} — run a hunt first`);
  process.exit(1);
}

const model = readAppModel(modelPath);
console.log(`Loaded model with ${model.findings.length} real findings`);

// Inject synthetic findings to test the generator
const syntheticFindings = [
  {
    id: 'synth-idor-1',
    type: 'idor' as const,
    severity: 'high' as const,
    confidence: 0.85,
    endpoint: 'http://127.0.0.1:4567/api/users/1',
    method: 'GET',
    param: 'id',
    payload: '1',
    description: 'User with id=1 can be accessed by another user (id=2) — broken access control on object reference',
    evidence: [{ type: 'text' as const, data: '{"id":1,"name":"alice","role":"admin","balance":9999}', label: 'response-as-other-user' }],
    discoveredAt: Date.now(),
    reproducer: 'curl -H "Cookie: session=user2" http://target/api/users/1',
  },
  {
    id: 'synth-xss-1',
    type: 'xss' as const,
    severity: 'high' as const,
    confidence: 0.78,
    endpoint: 'http://127.0.0.1:4567/api/preview',
    method: 'GET',
    param: 'q',
    payload: '"><script>alert(1)</script>',
    description: 'Reflected XSS in search parameter — unsanitized output',
    evidence: [{ type: 'text' as const, data: '...<script>alert(1)</script>...', label: 'raw-response' }],
    discoveredAt: Date.now(),
    reproducer: 'curl "http://target/api/preview?q=..."><script>alert(1)</script>"',
  },
  {
    id: 'synth-sqli-1',
    type: 'sqli' as const,
    severity: 'critical' as const,
    confidence: 0.92,
    endpoint: 'http://127.0.0.1:4567/api/users',
    method: 'GET',
    param: 'id',
    payload: "1' OR '1'='1",
    description: 'SQL injection — response differs between injected and baseline queries',
    evidence: [{ type: 'text' as const, data: '{"users":[...],"rowCount":999}', label: 'error-disclosure' }],
    discoveredAt: Date.now(),
    reproducer: "curl 'http://target/api/users?id=1%27%20OR%20%271%27%3D%271'",
  },
  {
    id: 'synth-headers-1',
    type: 'headers' as const,
    severity: 'medium' as const,
    confidence: 0.95,
    endpoint: 'http://127.0.0.1:4567/',
    method: 'GET',
    param: '',
    payload: '',
    description: 'Missing security headers: Content-Security-Policy, X-Frame-Options, Strict-Transport-Security',
    evidence: [{ type: 'text' as const, data: 'response headers: {content-type: text/html}', label: 'header-diff' }],
    discoveredAt: Date.now(),
    reproducer: 'curl -I http://target/',
  },
];

model.findings = [...(model.findings || []), ...syntheticFindings];

// Also inject a synthetic chain
model.attackChains = [
  ...(model.attackChains || []),
  {
    id: 'synth-chain-1',
    name: 'account-takeover-via-idor-and-xss',
    severity: 'critical' as const,
    confidence: 0.74,
    narrative: 'Attacker can use IDOR to enumerate users, then use the reflected XSS to steal session cookies, leading to full account takeover.',
    exploitability: 'moderate' as const,
    steps: [
      { step: 1, findingType: 'idor', endpoint: '/api/users/1', evidenceRef: 'synth-idor-1', description: 'Enumerate user IDs' },
      { step: 2, findingType: 'xss', endpoint: '/api/preview', evidenceRef: 'synth-xss-1', description: 'Craft malicious link with session-stealing payload' },
      { step: 3, findingType: 'sqli', endpoint: '/api/users', evidenceRef: 'synth-sqli-1', description: 'Bypass auth check via SQL injection' },
    ],
    discoveredAt: Date.now(),
  },
];

writeAppModel(modelPath, model);
console.log(`Injected ${syntheticFindings.length} findings + 1 chain`);

// Now generate Playwright tests
const result = generateFindingTests(model, {
  outDir: testsDir,
  includeChainTests: true,
});
console.log(`\nGenerator produced:`);
console.log(`  ${result.findingsWritten} finding tests`);
console.log(`  ${result.chainsWritten} chain tests`);
console.log(`  total: ${result.files.length} files`);

// Write to disk
const written = writeFindingTests(result, testsDir);
console.log(`\nWrote ${written.length} files to ${testsDir}:`);
for (const f of written) {
  console.log(`  ${f}`);
}
