// Hamburger nav
const ham = document.getElementById('hamburger');
const sidenav = document.getElementById('sidenav');
const overlay = document.getElementById('overlay');
function setNav(open) {
  ham?.setAttribute('aria-expanded', String(open));
  sidenav?.setAttribute('aria-hidden', String(!open));
  overlay?.classList.toggle('show', open);
}
ham?.addEventListener('click', () => setNav(sidenav?.getAttribute('aria-hidden') !== 'false'));
overlay?.addEventListener('click', () => setNav(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

// Sync timestamp
function formatTs(ts) {
  try {
    const d = new Date(Number(ts));
    return d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
function updateSyncLabel() {
  const el = document.getElementById('sync-info');
  if (!el) return;
  const ts = localStorage.getItem('lastSync');
  el.textContent = ts
    ? `Offline-Inhalte aktualisiert: ${formatTs(ts)}`
    : 'Offline-Inhalte werden geladen…';
}
updateSyncLabel();

function updateOnlineActions() {
  const offline = navigator.onLine === false;
  document.body.classList.toggle('is-offline', offline);
  document.querySelectorAll('[data-online-only]').forEach((el) => {
    el.setAttribute('aria-disabled', String(offline));
    el.classList.toggle('is-disabled', offline);
  });
}
updateOnlineActions();
window.addEventListener('online', updateOnlineActions);
window.addEventListener('offline', updateOnlineActions);
document.addEventListener('click', (event) => {
  const action = event.target.closest?.('[data-online-only]');
  if (!action || navigator.onLine !== false) return;
  event.preventDefault();
  window.alert('Diese Funktion benötigt eine Verbindung zum Server.');
});

// Remember Name / Mobile across form fills (accounts are generic per role, so
// we cache these per-device in localStorage). Matches fields whose name is
// exactly "name" or "mobile" (case-insensitive).
(function rememberContactFields() {
  const form = document.querySelector('.genform');
  if (!form) return;
  const remembered = /^(name|mobile)$/i;
  const key = (name) => 'formcache:' + name.toLowerCase();
  form.querySelectorAll('input[name]').forEach((input) => {
    if (!remembered.test(input.name)) return;
    if (!input.value) {
      const saved = localStorage.getItem(key(input.name));
      if (saved) input.value = saved;
    }
    input.addEventListener('input', () => {
      try { localStorage.setItem(key(input.name), input.value); } catch {}
    });
  });
})();

// Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch((e) => console.warn('SW register failed', e));
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'SYNC_DONE') {
      localStorage.setItem('lastSync', String(data.ts || Date.now()));
      updateSyncLabel();
    }
  });
}
