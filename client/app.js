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


function initEnhancedForms() {
  document.querySelectorAll('form[data-enhanced-form]').forEach((form) => {
    const container = form.closest('.form-page') || form;
    const printButton = container.querySelector('[data-form-print]');
    if (!printButton) return;
    const update = () => {
      printButton.disabled = !form.checkValidity();
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    printButton.addEventListener('click', () => {
      if (!form.reportValidity()) {
        update();
        return;
      }
      window.print();
    });
    update();
  });
}

function initResultPrinting() {
  const cleanup = () => {
    document.body.classList.remove('print-selected-results');
    document.querySelectorAll('[data-print-row].is-print-selected').forEach((row) => row.classList.remove('is-print-selected'));
  };
  window.addEventListener('afterprint', cleanup);

  document.querySelectorAll('[data-results-print]').forEach((container) => {
    const rows = Array.from(container.querySelectorAll('[data-print-row]'));
    const checks = rows.map((row) => row.querySelector('[data-print-select]')).filter(Boolean);
    const selectAll = container.querySelector('[data-print-select-all]');
    const printButton = container.querySelector('[data-print-selected]');
    const count = container.querySelector('[data-print-count]');
    if (!checks.length || !printButton) return;

    const update = () => {
      const selected = checks.filter((check) => check.checked);
      printButton.disabled = selected.length === 0;
      if (count) count.textContent = selected.length === 1 ? '1 ausgewählt' : selected.length + ' ausgewählt';
      if (selectAll) {
        selectAll.checked = selected.length === checks.length;
        selectAll.indeterminate = selected.length > 0 && selected.length < checks.length;
      }
    };

    checks.forEach((check) => check.addEventListener('change', update));
    selectAll?.addEventListener('change', () => {
      checks.forEach((check) => { check.checked = selectAll.checked; });
      update();
    });
    printButton.addEventListener('click', () => {
      const selectedRows = rows.filter((row) => row.querySelector('[data-print-select]')?.checked);
      if (!selectedRows.length) return;
      cleanup();
      selectedRows.forEach((row) => row.classList.add('is-print-selected'));
      document.body.classList.add('print-selected-results');
      window.print();
      window.setTimeout(cleanup, 500);
    });
    update();
  });
}

initEnhancedForms();
initResultPrinting();
