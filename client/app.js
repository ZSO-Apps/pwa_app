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

// Design theme
const THEME_STORAGE_KEY = 'zso-theme';
const themeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

function validThemeChoice(value) {
  return value === 'light' || value === 'dark' || value === 'system';
}

function storedThemeChoice() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return validThemeChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function resolveTheme(choice) {
  if (choice === 'light' || choice === 'dark') return choice;
  return themeQuery?.matches ? 'dark' : 'light';
}

function applyTheme(choice = storedThemeChoice()) {
  const normalized = validThemeChoice(choice) ? choice : 'system';
  const resolved = resolveTheme(normalized);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeChoice = normalized;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#003B6F' : '#005A9C');
  document.querySelectorAll('[data-theme-select]').forEach((select) => {
    select.value = normalized;
  });
}

function initThemeSelector() {
  applyTheme();
  document.querySelectorAll('[data-theme-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const choice = validThemeChoice(select.value) ? select.value : 'system';
      try { localStorage.setItem(THEME_STORAGE_KEY, choice); } catch {}
      applyTheme(choice);
    });
  });
  themeQuery?.addEventListener?.('change', () => {
    if (storedThemeChoice() === 'system') applyTheme('system');
  });
}

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


function removePrintBundle() {
  document.body.classList.remove('print-detail-bundle');
  document.getElementById('print-bundle')?.remove();
}

function ensurePrintBundle() {
  removePrintBundle();
  const bundle = document.createElement('div');
  bundle.id = 'print-bundle';
  document.body.appendChild(bundle);
  return bundle;
}

function fillDraftPrintTemplate(article, form) {
  const data = new FormData(form);
  article.querySelectorAll('[data-print-value]').forEach((el) => {
    const name = el.getAttribute('data-print-value');
    el.textContent = data.get(name) || '';
  });
  article.querySelectorAll('[data-print-check]').forEach((el) => {
    const name = el.getAttribute('data-print-check');
    const box = el.querySelector('.box');
    if (box) box.textContent = data.has(name) ? '☑' : '☐';
  });
  const generated = article.querySelector('[data-print-generated]');
  if (generated) generated.textContent = 'Druckvorschau, noch nicht gespeichert';
}

function waitForImages(root) {
  const images = Array.from(root.querySelectorAll('img'));
  return Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = window.setTimeout(resolve, 1500);
      const done = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }));
}

function nextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

async function printArticleElements(articles) {
  if (!articles.length) return;
  const bundle = ensurePrintBundle();
  articles.forEach((article) => {
    article.classList.add('print-page');
    bundle.appendChild(article);
  });
  document.body.classList.add('print-detail-bundle');
  await waitForImages(bundle);
  await nextPaint();
  window.print();
  window.setTimeout(removePrintBundle, 500);
}

async function fetchDetailArticle(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Detailansicht konnte nicht geladen werden.');
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const article = doc.querySelector('article.sub-detail') || doc.querySelector('main article.content') || doc.querySelector('main');
  if (!article) throw new Error('Detailansicht ist leer.');
  const clone = article.cloneNode(true);
  clone.querySelectorAll('script').forEach((el) => el.remove());
  clone.querySelectorAll('.no-print, .crumbs').forEach((el) => el.remove());
  return clone;
}

window.ZSOPrint = {
  form(root, form) {
    const detailUrl = root.querySelector('[data-form-print]')?.getAttribute('data-detail-url');
    if (detailUrl) {
      window.ZSOPrint.details([detailUrl]).catch((error) => {
        window.alert(error?.message || 'Detailansicht konnte nicht gedruckt werden.');
      });
      return;
    }
    const template = root.querySelector('template[data-form-print-template]');
    if (!template) {
      window.print();
      return;
    }
    const article = template.content.firstElementChild.cloneNode(true);
    fillDraftPrintTemplate(article, form);
    printArticleElements([article]);
  },
  details(urls) {
    return Promise.all(urls.map(fetchDetailArticle)).then(printArticleElements);
  },
};

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
    if (!printButton.dataset.printBound) {
      printButton.addEventListener('click', () => {
        if (!form.reportValidity()) {
          update();
          return;
        }
        window.ZSOPrint.form(container, form);
      });
      printButton.dataset.printBound = 'app';
    }
    update();
  });
}

function initResultPrinting() {
  const cleanup = () => {
    document.body.classList.remove('print-selected-results');
    document.querySelectorAll('[data-print-row].is-print-selected').forEach((row) => row.classList.remove('is-print-selected'));
    removePrintBundle();
  };
  window.addEventListener('afterprint', cleanup);

  document.querySelectorAll('[data-results-print]').forEach((container) => {
    const rows = Array.from(container.querySelectorAll('[data-print-row]'));
    const checks = rows.map((row) => row.querySelector('[data-print-select]')).filter(Boolean);
    const selectAll = container.querySelector('[data-print-select-all]');
    const printButton = container.querySelector('[data-print-selected]');
    const actionButtons = Array.from(container.querySelectorAll('[data-selected-action]'));
    const count = container.querySelector('[data-print-count]');
    if (!checks.length || (!printButton && !actionButtons.length)) return;

    const update = () => {
      const selected = checks.filter((check) => check.checked);
      if (printButton) printButton.disabled = selected.length === 0;
      actionButtons.forEach((button) => { button.disabled = selected.length === 0; });
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
    printButton?.addEventListener('click', async () => {
      const selectedRows = rows.filter((row) => row.querySelector('[data-print-select]')?.checked);
      const urls = selectedRows.map((row) => row.getAttribute('data-print-url')).filter(Boolean);
      if (!urls.length) return;
      cleanup();
      const oldHtml = printButton.innerHTML;
      printButton.disabled = true;
      printButton.setAttribute('aria-busy', 'true');
      try {
        await window.ZSOPrint.details(urls);
      } catch (error) {
        window.alert(error?.message || 'Detailansichten konnten nicht gedruckt werden.');
      } finally {
        printButton.innerHTML = oldHtml;
        printButton.removeAttribute('aria-busy');
        update();
      }
    });
    update();
  });
}

initThemeSelector();
initEnhancedForms();
initResultPrinting();
