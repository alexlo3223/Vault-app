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
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
  }).catch(() => null);
  if (res?.ok) return location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  fail(res?.status === 401 ? 'Email o contraseña incorrectos.' : 'No se pudo conectar. Inténtalo otra vez.');
});
