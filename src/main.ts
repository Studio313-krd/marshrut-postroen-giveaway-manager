import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
for (const [name, color] of Object.entries({ paper: '#e7e7e5', canvas: '#f4f4ef', ink: '#181917', accent: '#e52b08', muted: '#65665f', rule: '#cececa' })) document.documentElement.style.setProperty(`--${name}`, color);

function loginScreen() {
  document.body.className = 'login-page';
  root.innerHTML = `
    <header class="masthead"><div class="wordmark"><span class="mark" aria-hidden="true"></span>УДАЧА В КАДРЕ</div><span class="masthead-note">ДЛЯ ОРГАНИЗАТОРА</span></header>
    <main class="login-layout">
      <section class="login-intro"><p class="eyebrow">ВСЁ ГОТОВО К ВАШЕМУ КОНКУРСУ</p><h1>УДАЧА<br><span>ПОД КОНТРОЛЕМ</span></h1><p class="description">Настройте розыгрыш<br>Поймайте момент в одном видео</p></section>
      <form id="login-form" class="login-form">
        <span class="login-index" aria-hidden="true">↗</span><h2>Вход</h2><p>Войдите, чтобы провести розыгрыш</p>
        <label for="username">Логин</label><input id="username" name="username" autocomplete="username" required maxlength="64" autocapitalize="none" spellcheck="false" />
        <label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" />
        <button class="record-button" type="submit"><span id="login-label">Войти</span><span class="login-arrow" aria-hidden="true">↗</span></button>
        <p id="login-status" role="status" aria-live="polite"></p>
      </form>
    </main><footer class="page-footer"><span>РОЗЫГРЫШ / REELS</span><span>ОДИН КЛИК — ЧЬЯ-ТО УДАЧА</span></footer>`;
  const form = document.querySelector<HTMLFormElement>('#login-form')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (button.disabled) return;
    button.disabled = true;
    document.querySelector('#login-label')!.textContent = 'Входим';
    const status = document.querySelector('#login-status')!;
    status.textContent = '';
    try {
      const fields = new FormData(form);
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      form.reset(); document.body.className = '';
      await import('./app');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Не удалось войти — попробуйте ещё раз';
      button.disabled = false;
      document.querySelector('#login-label')!.textContent = 'Войти';
    }
  });
}

async function boot() {
  try {
    const session = await fetch('/api/auth/session').then(response => response.json());
    if (session.authenticated) { await import('./app'); return; }
  } catch { /* The login form exposes connection errors on submission. */ }
  loginScreen();
}
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void boot();
