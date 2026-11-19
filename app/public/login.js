// The web version's sign-in page: Google, or e-mail and password; then back to where you were going.
const next = new URLSearchParams(location.search).get('next') || '/';
const errorEl = document.getElementById('error');
const fail = (msg) => {
  errorEl.textContent = msg;
  errorEl.hidden = false;
};
document.getElementById('google').href = `/auth/google?next=${encodeURIComponent(next)}`;
if (new URLSearchParams(location.search).has('error')) fail('No se pudo entrar con Google. Inténtalo otra vez.');
// The desktop app's sign-in page ends here: the app has the session now.
if (new URLSearchParams(location.search).has('done')) {
  document.querySelector('main').replaceChildren(Object.assign(document.createElement('h1'), { textContent: 'Listo: vuelve a Vault' }));
}

document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const signup = e.submitter?.value === 'signup';
  const res = await fetch(signup ? '/auth/signup' : '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
  }).catch(() => null);
  const data = await res?.json().catch(() => ({}));
  if (res?.ok && data.confirm) return fail('Cuenta creada. Abre el enlace que te hemos enviado por email y luego entra.');
  if (res?.ok) return location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  if (signup) return fail(res?.status === 401 ? `No se pudo crear la cuenta: ${data?.error ?? 'revisa el email y la contraseña'}.` : 'No se pudo conectar. Inténtalo otra vez.');
  fail(res?.status === 401 ? 'Email o contraseña incorrectos.' : 'No se pudo conectar. Inténtalo otra vez.');
});
