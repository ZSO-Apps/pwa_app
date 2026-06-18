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


function initContentActions() {
  document.querySelectorAll('[data-content-actions]').forEach((root) => {
    const toggle = root.querySelector('[data-content-menu-toggle]');
    const menu = root.querySelector('[data-content-menu]');
    const dialog = root.querySelector('[data-content-import-dialog]');
    const form = root.querySelector('[data-content-import-form]');
    const title = root.querySelector('[data-content-import-title]');
    const nameInput = root.querySelector('[data-content-import-name]');
    const fileInput = root.querySelector('[data-content-import-file]');
    const dropzone = root.querySelector('[data-content-dropzone]');
    const fileName = root.querySelector('[data-content-import-file-name]');
    const errorEl = root.querySelector('[data-content-import-error]');
    const kachelId = root.getAttribute('data-kachel-id');
    const dir = root.getAttribute('data-content-dir') || '';
    let currentType = '';
    let selectedFile = null;

    const setMenu = (open) => {
      if (!menu || !toggle) return;
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    const setError = (message = '') => {
      if (!errorEl) return;
      errorEl.hidden = !message;
      errorEl.textContent = message;
    };
    const setFile = (file) => {
      selectedFile = file || null;
      if (fileName) fileName.textContent = selectedFile ? selectedFile.name : 'Keine Datei ausgewählt.';
      if (selectedFile && nameInput && !nameInput.value) nameInput.value = selectedFile.name.replace(/\.[^.]+$/, '');
    };
    const openDialog = (button) => {
      currentType = button.getAttribute('data-content-import') || '';
      if (title) title.textContent = button.getAttribute('data-import-title') || 'Importieren';
      if (fileInput) fileInput.accept = button.getAttribute('data-import-accept') || '';
      if (nameInput) nameInput.value = '';
      setFile(null);
      setError('');
      setMenu(false);
      if (dialog?.showModal) dialog.showModal();
      else dialog?.setAttribute('open', '');
    };

    toggle?.addEventListener('click', (event) => {
      event.stopPropagation();
      setMenu(menu?.hidden !== false);
    });
    root.querySelectorAll('[data-content-import]').forEach((button) => button.addEventListener('click', () => openDialog(button)));
    root.querySelectorAll('[data-content-import-close]').forEach((button) => {
      button.addEventListener('click', () => dialog?.close ? dialog.close() : dialog?.removeAttribute('open'));
    });
    fileInput?.addEventListener('change', () => setFile(fileInput.files?.[0]));
    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });
    ['dragenter', 'dragover'].forEach((name) => {
      dropzone?.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragging');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      dropzone?.addEventListener(name, () => dropzone.classList.remove('is-dragging'));
    });
    dropzone?.addEventListener('drop', (event) => {
      event.preventDefault();
      setFile(event.dataTransfer?.files?.[0]);
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');
      const name = nameInput?.value?.trim() || '';
      if (!name) return setError('Bitte einen Dateinamen angeben.');
      if (!selectedFile) return setError('Bitte eine Datei auswählen.');
      const params = new URLSearchParams({ dir, type: currentType, name });
      const submit = form.querySelector('button[type="submit"]');
      const oldText = submit?.textContent;
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Importiere…';
      }
      try {
        const response = await fetch('/content-admin/' + encodeURIComponent(kachelId) + '/import?' + params.toString(), {
          method: 'POST',
          body: selectedFile,
          headers: {
            'Content-Type': selectedFile.type || 'application/octet-stream',
            'X-Original-Filename': encodeURIComponent(selectedFile.name),
          },
          credentials: 'same-origin',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || 'Import fehlgeschlagen.');
        window.location.href = data.url || window.location.href;
      } catch (error) {
        setError(error?.message || 'Import fehlgeschlagen.');
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.textContent = oldText;
        }
      }
    });
  });

  document.addEventListener('click', (event) => {
    document.querySelectorAll('[data-content-actions]').forEach((root) => {
      if (root.contains(event.target)) return;
      const menu = root.querySelector('[data-content-menu]');
      const toggle = root.querySelector('[data-content-menu-toggle]');
      if (menu) menu.hidden = true;
      toggle?.setAttribute('aria-expanded', 'false');
    });
  });
}

function initMarkdownEditor() {
  const root = document.querySelector('[data-markdown-editor-page]');
  if (!root) return;
  const textarea = root.querySelector('[data-markdown-editor]');
  const preview = root.querySelector('[data-markdown-preview]');
  if (!textarea || !preview) return;

  const htmlEscape = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
  const inline = (value) => htmlEscape(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const renderPreview = () => {
    const lines = textarea.value.split(/\r?\n/);
    let html = '';
    let inList = false;
    const closeList = () => {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
    };
    for (const line of lines) {
      if (!line.trim()) {
        closeList();
        continue;
      }
      const list = line.match(/^\s*[-*]\s+(.+)$/);
      if (list) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += '<li>' + inline(list[1]) + '</li>';
        continue;
      }
      closeList();
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
      } else {
        html += '<p>' + inline(line) + '</p>';
      }
    }
    closeList();
    preview.innerHTML = html || '<p class="muted">Vorschau</p>';
  };
  const selectedText = () => textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  const replaceSelection = (value) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.setRangeText(value, start, end, 'select');
    textarea.focus();
    renderPreview();
  };
  const wrapSelection = (before, after = before, fallback = 'Text') => {
    const text = selectedText() || fallback;
    replaceSelection(before + text + after);
  };
  root.querySelectorAll('[data-md-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.getAttribute('data-md-action');
      if (action === 'heading') wrapSelection('## ', '', 'Überschrift');
      else if (action === 'bold') wrapSelection('**', '**');
      else if (action === 'italic') wrapSelection('*', '*');
      else if (action === 'link') wrapSelection('[', '](https://)', 'Linktext');
      else if (action === 'list') {
        const lines = (selectedText() || 'Listenpunkt').split(/\r?\n/);
        replaceSelection(lines.map((line) => '- ' + line.replace(/^[-*]\s+/, '')).join('\n'));
      }
    });
  });
  textarea.addEventListener('input', renderPreview);
  renderPreview();
}

initThemeSelector();
initEnhancedForms();
initContentActions();
initMarkdownEditor();
initResultPrinting();
