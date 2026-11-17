// The web version's sign-in (lib/cloud.mjs) against a stand-in for Supabase Auth.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../server.mjs';
import { createCloud } from '../lib/cloud.mjs';

const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const TOKEN = jwt({ sub: 'u1', email: 'yo@example.com', exp: Math.floor(Date.now() / 1000) + 3600 });
let fake;
let app;
const seen = [];

before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization });
      const json = (status, data) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      if (req.url === '/auth/v1/token?grant_type=password') {
        const { password } = JSON.parse(body);
        return password === 'bien' ? json(200, { access_token: TOKEN, refresh_token: 'r1', user: { id: 'u1' } }) : json(400, { msg: 'Invalid login credentials' });
      }
      if (req.url === '/auth/v1/oauth/authorizations/abc') return json(200, { authorization_id: 'abc', client: { name: '<img src=x onerror=alert(1)>' }, scope: 'openid' });
      if (req.url === '/auth/v1/oauth/authorizations/abc/consent') return json(200, { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=c1' });
      json(404, {});
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  app = http.createServer(createHandler({ cloud: createCloud({ url: `http://127.0.0.1:${fake.address().port}`, key: 'k' }) }));
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
});
after(() => {
  fake.close();
  app.close();
});

function call(method, path, { headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const req = http.request({ host: '127.0.0.1', port: app.address().port, method, path, headers: { host: 'vault.example', 'x-forwarded-proto': 'https', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', fail);
    req.end(body);
  });
}
const cookieOf = (res) => (res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');

async function signIn() {
  const res = await call('POST', '/auth/login', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'yo@example.com', password: 'bien' }) });
  assert.equal(res.status, 200);
  assert.match(res.headers['set-cookie'][0], /^vault_session=.+HttpOnly; Secure; SameSite=Lax/);
  return cookieOf(res);
}

test('notes need a session, and a wrong password gets none', async () => {
  assert.equal((await call('GET', '/api/tree')).status, 401);
  const bad = await call('POST', '/auth/login', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'mal' }) });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers['set-cookie'], undefined);
  assert.equal((await call('GET', '/api/tree', { headers: { cookie: 'vault_session=basura' } })).status, 401);
});

test('a session knows who is signed in', async () => {
  const me = await call('GET', '/auth/me', { headers: { cookie: await signIn() } });
  assert.deepEqual(JSON.parse(me.body), { email: 'yo@example.com' });
});

test('Google sign-in never sends you to another site afterwards', async () => {
  const res = await call('GET', '/auth/google?next=//evil.example/x');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/auth\/v1\/authorize\?provider=google&redirect_to=https%3A%2F%2Fvault\.example%2Fauth%2Fcallback&code_challenge=/);
  const pkce = JSON.parse(decodeURIComponent(res.headers['set-cookie'][0].split(';')[0].split('=').slice(1).join('=')));
  assert.equal(pkce.next, '/');
});

test('Claude consent: asks to sign in first, escapes the app name, and returns to Claude', async () => {
  const anon = await call('GET', '/oauth/consent?authorization_id=abc');
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.location, '/login.html?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc');

  const cookie = await signIn();
  const page = await call('GET', '/oauth/consent?authorization_id=abc', { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.ok(!page.body.includes('<img src=x'));
  assert.match(page.body, /&#60;img src=x onerror=alert\(1\)&#62; quiere acceder/);

  const ok = await call('POST', '/oauth/consent', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://vault.example' }, body: 'authorization_id=abc&decision=approve' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, 'https://claude.ai/api/mcp/auth_callback?code=c1');
  assert.deepEqual(JSON.parse(seen.at(-1).body), { action: 'approve' });
  assert.equal(seen.at(-1).auth, `Bearer ${TOKEN}`);

  const forged = await call('POST', '/oauth/consent', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }, body: 'authorization_id=abc&decision=approve' });
  assert.equal(forged.status, 403);
});
