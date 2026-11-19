// The web version's sign-in, on Supabase Auth: Google or e-mail and password, kept in an httpOnly cookie.
// Also the consent page Supabase sends Claude's sign-in to (/oauth/consent), where you allow Claude into your notes.
// Supabase checks the token on every query, so this module only carries it; it never trusts it on its own.
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { HttpError } from '../server.mjs';
import { supabaseStore } from './store-supabase.mjs';

const SESSION = 'vault_session';
const PKCE = 'vault_pkce';
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Only paths of this site, never "//other.site" or "https://…".
const safeNext = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/');

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAge) {
  const prev = [res.getHeader('set-cookie') ?? []].flat();
  res.setHeader('set-cookie', [...prev, `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`]);
}

const jwtPayload = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

// `onSignIn(session)` lets the desktop app keep the session it gets from its own sign-in page (desktop/sync.mjs).
export function createCloud({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY, onSignIn } = {}) {
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY');
  const auth = async (path, { method = 'POST', body, token } = {}) => {
    const res = await fetch(`${url}/auth/v1${path}`, {
      method,
      headers: { apikey: key, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError([400, 401, 422].includes(res.status) ? 401 : 502, data.msg || data.error_description || data.message || 'no se pudo iniciar sesión');
    return data;
  };
  const keep = (res, s) => {
    setCookie(res, SESSION, b64url(JSON.stringify({ a: s.access_token, r: s.refresh_token })), 60 * 60 * 24 * 30);
    onSignIn?.(s);
  };

  // The signed-in user's access token, refreshed when it is about to expire; null when nobody is signed in.
  async function session(req, res) {
    const raw = cookies(req)[SESSION];
    if (!raw) return null;
    let s;
    try {
      s = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    const claims = jwtPayload(s.a);
    if (claims && claims.exp * 1000 > Date.now() + 60_000) return { token: s.a, user: claims.sub, email: claims.email };
    try {
      const fresh = await auth('/token?grant_type=refresh_token', { body: { refresh_token: s.r } });
      keep(res, fresh);
      return { token: fresh.access_token, user: fresh.user.id, email: fresh.user.email };
    } catch {
      setCookie(res, SESSION, '', 0);
      return null;
    }
  }

  async function storeFor(req, res) {
    const s = await session(req, res);
    if (!s) throw new HttpError(401, 'inicia sesión');
    const db = createClient(url, key, {
      global: { headers: { authorization: `Bearer ${s.token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return supabaseStore(db, s.user);
  }

  async function route(req, res, reqUrl, { readJson, readForm, send }) {
    const redirect = (to) => {
      res.writeHead(302, { location: to, 'cache-control': 'no-store' });
      res.end();
    };
    const origin = `${reqUrl.protocol}//${reqUrl.host}`;
    switch (`${req.method} ${reqUrl.pathname}`) {
      case 'POST /auth/login': {
        const body = await readJson(req);
        if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'faltan el email o la contraseña');
        keep(res, await auth('/token?grant_type=password', { body: { email: body.email, password: body.password } }));
        return send(res, 200, { ok: true });
      }
      // New account. With "Confirm email" on in Supabase there is no session yet: the person confirms by e-mail first.
      case 'POST /auth/signup': {
        const body = await readJson(req);
        if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'faltan el email o la contraseña');
        const data = await auth('/signup', { body: { email: body.email, password: body.password } });
        if (!data.access_token) return send(res, 200, { confirm: true });
        keep(res, data);
        return send(res, 200, { ok: true });
      }
      // Google, with PKCE: the code that comes back is useless without the secret kept in this browser's cookie.
      case 'GET /auth/google': {
        const verifier = b64url(randomBytes(32));
        setCookie(res, PKCE, JSON.stringify({ verifier, next: safeNext(reqUrl.searchParams.get('next')) }), 600);
        const q = new URLSearchParams({
          provider: 'google',
          redirect_to: `${origin}/auth/callback`,
          code_challenge: b64url(createHash('sha256').update(verifier).digest()),
          code_challenge_method: 's256',
        });
        return redirect(`${url}/auth/v1/authorize?${q}`);
      }
      case 'GET /auth/callback': {
        let pkce;
        try {
          pkce = JSON.parse(cookies(req)[PKCE]);
        } catch {
          return redirect('/login.html?error=1');
        }
        setCookie(res, PKCE, '', 0);
        const code = reqUrl.searchParams.get('code');
        if (!code) return redirect('/login.html?error=1');
        keep(res, await auth('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: pkce.verifier } }));
        return redirect(safeNext(pkce.next));
      }
      case 'POST /auth/logout': {
        const s = await session(req, res);
        if (s) await auth('/logout', { token: s.token }).catch(() => {});
        setCookie(res, SESSION, '', 0);
        return send(res, 200, { ok: true });
      }
      case 'GET /auth/me': {
        const s = await session(req, res);
        if (!s) throw new HttpError(401, 'inicia sesión');
        return send(res, 200, { email: s.email });
      }
      // Supabase sends Claude's sign-in here; you say whether Claude may use your notes.
      case 'GET /oauth/consent': {
        const id = reqUrl.searchParams.get('authorization_id') ?? '';
        const s = await session(req, res);
        if (!s) return redirect(`/login.html?next=${encodeURIComponent(reqUrl.pathname + reqUrl.search)}`);
        const details = await auth(`/oauth/authorizations/${encodeURIComponent(id)}`, { method: 'GET', token: s.token });
        if (details.redirect_url && !details.authorization_id) return redirect(details.redirect_url); // allowed before
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'self'; form-action 'self' https:; frame-ancestors 'none'",
          'cache-control': 'no-store',
        });
        return res.end(consentPage({ id, client: details.client?.name ?? details.client?.client_name ?? 'Una aplicación', email: s.email, scope: details.scope ?? '' }));
      }
      case 'POST /oauth/consent': {
        const form = await readForm(req);
        const s = await session(req, res);
        if (!s) throw new HttpError(401, 'inicia sesión');
        const action = form.get('decision') === 'approve' ? 'approve' : 'deny';
        const done = await auth(`/oauth/authorizations/${encodeURIComponent(form.get('authorization_id') ?? '')}/consent`, { token: s.token, body: { action } });
        return redirect(done.redirect_url);
      }
      default:
        throw new HttpError(404, 'no encontrado');
    }
  }

  return { storeFor, route };
}

// The client name comes from whoever registered the app, so everything shown here is escaped.
const consentPage = ({ id, client, email, scope }) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Permitir acceso · Vault</title><link rel="stylesheet" href="/login.css"></head>
<body><main class="card">
<h1>${escapeHtml(client)} quiere acceder a tu Vault</h1>
<p>Podrá <strong>buscar, leer, crear y editar</strong> tus notas, y mandarlas a la papelera, como la cuenta <strong>${escapeHtml(email ?? '')}</strong>.</p>
${scope ? `<p class="muted">Permisos pedidos: ${escapeHtml(scope)}</p>` : ''}
<form method="post" action="/oauth/consent">
<input type="hidden" name="authorization_id" value="${escapeHtml(id)}">
<button name="decision" value="approve" class="primary">Permitir</button>
<button name="decision" value="deny">Cancelar</button>
</form>
<p class="muted">Puedes quitar el acceso cuando quieras desde los conectores de Claude.</p>
</main></body></html>`;
