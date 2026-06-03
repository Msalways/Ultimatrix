// demo-target/server.js
//
// Vulnerable-by-design Node.js/Express app used as a stable test surface
// for the Ultimatrix recon + specialist + chain engine pipeline.
//
// Each seeded vulnerability maps to a specialist or recon layer so the
// orchestrator can demonstrate advanced findings end-to-end.
//
// Run:   node demo-target/server.js
// Port:  4567
//
// Vulnerabilities:
//   1. OAuth redirect_uri prefix-bypass          -> src/agents/specialists/oauth.ts
//   2. JWT HS256 weak secret + alg=none accepted -> src/agents/specialists/jwt-v2.ts
//   3. SSRF on /api/preview?url=                 -> src/agents/specialists/cloud.ts
//   4. SSTI on /api/render?template=             -> src/agents/specialists/ssti.ts (Phase 2)
//   5. File upload Content-Type bypass           -> src/agents/specialists/upload.ts (Phase 2)
//   6. IDOR on /api/users/:id                    -> src/agents/specialists/idor-v2.ts
//   7. Race condition on /api/transfer           -> src/agents/specialists/race.ts
//   8. Race condition on /api/coupons/redeem     -> src/agents/specialists/race.ts
//   9. GraphQL introspection enabled             -> src/agents/specialists/graphql.ts
//  10. GraphQL field-level authz missing         -> src/agents/specialists/graphql.ts
//  11. Stored XSS in /api/messages               -> src/agents/specialists/xss.ts
//  12. Broken Function-Level Authz /admin        -> idor-v2 + jwt-v2 chain
//  13. Cloud metadata leak via SSRF chain        -> src/core/attack-chain.ts (kill chain)

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 4567;
const JWT_SECRET = 'secret123'; // vulnerability 2: weak HS256 secret
const DATA_FILE = path.join(__dirname, 'data.json');

const USERS = [
  { id: 1, username: 'alice', password: 'password123', role: 'user', balance: 1000 },
  { id: 2, username: 'bob',   password: 'password123', role: 'user', balance: 500 },
  { id: 3, username: 'admin', password: 'admin123',    role: 'admin', balance: 999999 },
];

let POSTS = [{ id: 1, author: 1, title: 'Hello world', body: 'first post' }];
let MESSAGES = [];
let COUPONS = { 'PROMO50': { used: false, discount: 0.5 } };

// ── helpers ──────────────────────────────────────────────────────────────

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecodeString(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function b64urlDecodeBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signJwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${base64url(sig)}`;
}

// vulnerability 2: accepts alg=none
function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header;
  try { header = JSON.parse(b64urlDecodeString(h)); } catch { return null; }
  let payload;
  try { payload = JSON.parse(b64urlDecodeString(p)); } catch { return null; }

  if (header.alg === 'none') {
    return s === '' ? payload : null; // accepts unsigned token if signature is empty
  }
  if (header.alg === 'HS256') {
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest();
    const actual = b64urlDecodeBytes(s);
    if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
      return payload;
    }
    return null;
  }
  return null;
}

function getUser(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  const token = m ? m[1] : (req.cookies?.token || '');
  if (!token) return null;
  return verifyJwt(token);
}

function getUserIdFromToken(req) {
  const u = getUser(req);
  return u ? u.sub : null;
}

function getUserById(id) {
  return USERS.find(u => u.id === Number(id)) || null;
}

// vulnerability 6: IDOR — no auth check
function getUserHandler(req, res) {
  const target = getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  // returns password too — extra information disclosure
  res.json(target);
}

function listUsersHandler(req, res) {
  // vulnerability 12: returns all users including admins, no auth check
  res.json(USERS);
}

// vulnerability 3: SSRF
async function previewHandler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) {
      return res.status(400).json({ error: 'protocol not allowed' });
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const text = await r.text();
    res.json({ status: r.status, body: text.slice(0, 4096) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// vulnerability 4: SSTI via eval-ish template rendering
function renderHandler(req, res) {
  const template = req.query.template || '';
  // simulate template engine that interpolates {{var}} from a "context"
  // but ALSO evaluates inline expressions inside <%= ... %>
  if (/<%=(.+?)%>/.test(template)) {
    try {
      const out = template.replace(/<%=(.+?)%>/g, (_, expr) => {
        // vuln: executes arbitrary JS in node context
        return Function('"use strict"; return (' + expr + ')')();
      });
      return res.type('text/html').send(out);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.type('text/html').send(template);
}

// vulnerability 7: race condition (no transaction, no lock)
let transferInFlight = 0;
async function transferHandler(req, res) {
  const { to, amount } = req.body || {};
  const userId = getUserIdFromToken(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'bad amount' });

  const sender = getUserById(userId);
  const recipient = getUserById(to);
  if (!sender || !recipient) return res.status(404).json({ error: 'user not found' });
  if (sender.balance < amt) return res.status(400).json({ error: 'insufficient funds' });

  transferInFlight++;
  // simulate processing latency — opens the race window
  await new Promise(r => setTimeout(r, 50));
  sender.balance -= amt;
  recipient.balance += amt;
  transferInFlight--;

  res.json({ ok: true, balance: sender.balance });
}

// vulnerability 8: race condition on coupon reuse
async function redeemHandler(req, res) {
  const { code } = req.body || {};
  const userId = getUserIdFromToken(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const coupon = COUPONS[code];
  if (!coupon) return res.status(404).json({ error: 'unknown coupon' });
  if (coupon.used) return res.status(409).json({ error: 'already used' });

  // window between check and set
  await new Promise(r => setTimeout(r, 30));
  coupon.used = true;
  res.json({ ok: true, discount: coupon.discount });
}

// vulnerability 9 + 10: GraphQL
async function graphqlHandler(req, res) {
  const { query, variables } = req.body || {};
  const user = getUser(req);
  const result = await runGraphQL(query, variables || {}, user);
  res.json(result);
}

async function runGraphQL(query, vars, user) {
  // introspection enabled
  if (query.includes('__schema')) {
    return {
      data: {
        __schema: {
          types: [
            { name: 'User', fields: [
              { name: 'id', type: 'Int' },
              { name: 'username', type: 'String' },
              { name: 'password', type: 'String' },
              { name: 'role', type: 'String' },
              { name: 'balance', type: 'Int' },
            ]},
            { name: 'Query', fields: [
              { name: 'users', type: '[User]' },
              { name: 'me', type: 'User' },
              { name: 'adminStats', type: 'String' },
            ]},
          ],
        },
      },
    };
  }
  if (/query\s+[A-Z]?\s*\{?\s*users/.test(query)) {
    return { data: { users: USERS } };
  }
  if (/query\s+[A-Z]?\s*\{?\s*me/.test(query)) {
    if (!user) return { errors: [{ message: 'unauthorized' }] };
    return { data: { me: getUserById(user.sub) } };
  }
  // vulnerability 10: adminStats accessible without admin role
  if (/adminStats/.test(query)) {
    return { data: { adminStats: 'total_users=' + USERS.length + ' total_balance=' + USERS.reduce((s, u) => s + u.balance, 0) } };
  }
  return { errors: [{ message: 'unknown query' }] };
}

// vulnerability 1: OAuth redirect_uri prefix-bypass
const OAUTH_CLIENTS = {
  'demo-app': {
    secret: 'demo-secret',
    // vulnerability: only checks that redirect_uri starts with a registered prefix
    // and the suffix can contain anything (no strict equality)
    allowedRedirectPrefixes: ['https://demo-app.test/', 'https://localhost:3000/'],
  },
};

const OAUTH_CODES = new Map();

function oauthAuthorizeHandler(req, res) {
  const { client_id, redirect_uri, state, response_type, scope } = req.query;
  const client = OAUTH_CLIENTS[client_id];
  if (!client) return res.status(400).json({ error: 'unknown client' });
  if (!redirect_uri) return res.status(400).json({ error: 'redirect_uri required' });

  // vulnerability: prefix check is bypassable
  // attacker uses https://demo-app.test/.attacker.com/ to land on attacker.com
  const ok = client.allowedRedirectPrefixes.some(p => redirect_uri.startsWith(p));
  if (!ok) return res.status(400).json({ error: 'invalid redirect_uri' });

  const code = crypto.randomBytes(8).toString('hex');
  OAUTH_CODES.set(code, { client_id, scope: scope || 'read', created: Date.now() });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
}

function oauthTokenHandler(req, res) {
  const { code, client_id, client_secret } = req.body || {};
  const entry = OAUTH_CODES.get(code);
  if (!entry) return res.status(400).json({ error: 'invalid code' });
  if (entry.client_id !== client_id) return res.status(400).json({ error: 'client mismatch' });
  if (OAUTH_CLIENTS[client_id].secret !== client_secret) return res.status(400).json({ error: 'bad secret' });
  OAUTH_CODES.delete(code);

  const token = signJwtHS256({
    sub: 'oauth-user',
    client_id,
    scope: entry.scope,
    iat: Math.floor(Date.now() / 1000),
  }, JWT_SECRET);
  res.json({ access_token: token, token_type: 'Bearer', scope: entry.scope });
}

function oidcDiscoveryHandler(req, res) {
  res.json({
    issuer: 'http://localhost:' + PORT,
    authorization_endpoint: 'http://localhost:' + PORT + '/oauth/authorize',
    token_endpoint: 'http://localhost:' + PORT + '/oauth/token',
    jwks_uri: 'http://localhost:' + PORT + '/.well-known/jwks.json',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    scopes_supported: ['read', 'write', 'admin'],
  });
}

// vulnerability 12: admin route checks role claim — forgeable via alg=none
function adminDashboardHandler(req, res) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  res.json({ secret: 'launch codes 0001', users: USERS });
}

// vulnerability 11: stored XSS
function messagesPostHandler(req, res) {
  const { body } = req.body || {};
  const userId = getUserIdFromToken(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  if (!body) return res.status(400).json({ error: 'body required' });
  MESSAGES.push({ id: MESSAGES.length + 1, author: userId, body, ts: Date.now() });
  res.json({ ok: true });
}

function messagesGetHandler(req, res) {
  res.type('html').send(`<html><body><h1>Messages</h1>${
    MESSAGES.map(m => `<div class="msg">${m.body}</div>`).join('')
  }</body></html>`);
}

// vulnerability 5: file upload trusts the claimed Content-Type and stores the
// file as if it were the claimed type. There is no magic-byte sniffing, no
// extension check, and no separate path for "dangerous" types. So an attacker
// can upload a PHP shell with Content-Type: image/jpeg and the server will
// happily write it to the uploads dir under that name.
const UPLOADS = {};
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

function uploadHandler(req, res) {
  // Accept whatever Content-Type the client sends. Trust the client.
  const claimedType = req.headers['content-type'] || 'application/octet-stream';
  const claimedName = req.headers['x-filename'] || 'upload.bin';
  // Look at the body bytes
  let body = Buffer.alloc(0);
  req.on('data', c => { body = Buffer.concat([body, c]); });
  req.on('end', () => {
    const stored = path.join(UPLOADS_DIR, claimedName);
    fs.writeFileSync(stored, body);
    UPLOADS[claimedName] = { type: claimedType, size: body.length, path: stored };
    res.json({ ok: true, stored: claimedName, claimedType, size: body.length });
  });
  req.on('error', e => res.status(500).json({ error: e.message }));
}

// ── middleware + app ─────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// simple cookie parser
app.use((req, res, next) => {
  const cookies = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.split('=');
    if (!k) continue;
    cookies[k.trim()] = decodeURIComponent(v.join('='));
  }
  req.cookies = cookies;
  next();
});

app.get('/', (req, res) => {
  res.type('html').send(`<html><body>
    <h1>Ultimatrix Demo Target</h1>
    <ul>
      <li><a href="/login">Login</a></li>
      <li><a href="/api/users">Users</a></li>
      <li><a href="/api/users/1">User 1 (IDOR)</a></li>
      <li><a href="/api/users/2">User 2</a></li>
      <li><a href="/api/users/3">User 3 (admin)</a></li>
      <li><a href="/api/posts/1">Post 1</a></li>
      <li><a href="/admin/dashboard">Admin dashboard (auth)</a></li>
      <li><a href="/api/messages">Messages</a></li>
    </ul>
    <h2>Recon endpoints</h2>
    <ul>
      <li><a href="/.well-known/openid-configuration">/.well-known/openid-configuration</a></li>
      <li><code>POST /graphql</code> — introspection enabled</li>
      <li><code>GET /api/preview?url=</code> — SSRF</li>
      <li><code>GET /api/render?template=</code> — SSTI</li>
    </ul>
  </body></html>`);
});

app.get('/login', (req, res) => {
  res.type('html').send(`<html><body>
    <h1>Login</h1>
    <form method="POST" action="/login">
      <input name="username" placeholder="username" />
      <input name="password" type="password" placeholder="password" />
      <button type="submit">Login</button>
    </form>
    <p>Try: alice/password123, bob/password123, admin/admin123</p>
  </body></html>`);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const token = signJwtHS256({
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, JWT_SECRET);
  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly`);
  res.json({ token, user });
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'token=; Path=/; Max-Age=0');
  res.redirect('/');
});

app.get('/api/users', listUsersHandler);
app.get('/api/users/:id', getUserHandler);

app.get('/api/posts', (req, res) => res.json(POSTS));
app.get('/api/posts/:id', (req, res) => {
  const p = POSTS.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});
app.post('/api/posts', (req, res) => {
  const userId = getUserIdFromToken(req);
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const { title, body } = req.body || {};
  const post = { id: POSTS.length + 1, author: userId, title, body };
  POSTS.push(post);
  res.json(post);
});

app.get('/api/messages', messagesGetHandler);
app.post('/api/messages', messagesPostHandler);

app.get('/api/preview', previewHandler);
app.get('/api/render', renderHandler);
app.post('/api/transfer', transferHandler);
app.post('/api/coupons/redeem', redeemHandler);

app.post('/graphql', graphqlHandler);
app.post('/api/upload', uploadHandler);

app.get('/oauth/authorize', oauthAuthorizeHandler);
app.post('/oauth/token', express.urlencoded({ extended: true }), oauthTokenHandler);
app.get('/.well-known/openid-configuration', oidcDiscoveryHandler);
app.get('/.well-known/jwks.json', (req, res) => res.json({ keys: [] }));

app.get('/admin/dashboard', adminDashboardHandler);

app.get('/health', (req, res) => res.json({ ok: true, pid: process.pid }));

// write initial data file
fs.writeFileSync(DATA_FILE, JSON.stringify({ users: USERS, posts: POSTS, messages: MESSAGES }, null, 2));

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[demo-target] listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = { app, signJwtHS256, verifyJwt, USERS };
