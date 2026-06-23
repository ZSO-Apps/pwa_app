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
    const values = data.getAll(name).filter(Boolean);
    el.textContent = values.length > 1 ? values.join(', ') : (values[0] || '');
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
    const validateCheckboxGroups = () => {
      form.querySelectorAll('[data-checkbox-group][data-required="true"]').forEach((group) => {
        const inputs = Array.from(group.querySelectorAll('input[type="checkbox"]'));
        const first = inputs[0];
        if (!first) return;
        const valid = inputs.some((input) => input.checked);
        first.setCustomValidity(valid ? '' : 'Bitte mindestens eine Antwort auswählen.');
      });
    };
    const update = () => {
      validateCheckboxGroups();
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

function initResultsTables() {
  document.querySelectorAll('[data-results-table]').forEach((table) => {
    const container = table.closest('[data-results-print]') || table.parentElement;
    const filter = container?.querySelector('[data-results-filter]');
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = Array.from(tbody.rows);

    const normalize = (value) => String(value || '').toLocaleLowerCase('de-CH').replace(/\s+/g, ' ').trim();
    const parseValue = (value) => {
      const text = String(value || '').trim();
      const date = text.match(/^(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})/);
      if (date) return new Date(Number(date[3]), Number(date[2]) - 1, Number(date[1]), Number(date[4]), Number(date[5])).getTime();
      const score = text.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (score) {
        const total = Number(score[2]) || 1;
        return Number(score[1]) / total;
      }
      const normalizedNumber = text.replace(/'/g, '').replace(/\s/g, '').replace(',', '.');
      if (/^-?\d+(\.\d+)?$/.test(normalizedNumber)) return Number(normalizedNumber);
      return normalize(text);
    };
    const compareValues = (a, b) => {
      const left = parseValue(a);
      const right = parseValue(b);
      if (typeof left === 'number' && typeof right === 'number') return left - right;
      return String(left).localeCompare(String(right), 'de', { numeric: true, sensitivity: 'base' });
    };
    const visibleRows = () => rows.filter((row) => !row.hidden);
    const notifyTableChanged = () => {
      container?.dispatchEvent(new CustomEvent('results-table-updated'));
    };

    filter?.addEventListener('input', () => {
      const query = normalize(filter.value);
      rows.forEach((row) => {
        row.hidden = Boolean(query) && !normalize(row.textContent).includes(query);
      });
      notifyTableChanged();
    });

    table.querySelectorAll('[data-sort-col]').forEach((button) => {
      button.addEventListener('click', () => {
        const dataIndex = Number(button.getAttribute('data-sort-col'));
        if (!Number.isInteger(dataIndex)) return;
        const th = button.closest('th');
        const nextDir = th?.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        table.querySelectorAll('thead th[aria-sort]').forEach((head) => {
          head.setAttribute('aria-sort', 'none');
          head.querySelector('[data-sort-indicator], .sort-indicator')?.replaceChildren();
        });
        th?.setAttribute('aria-sort', nextDir);
        const indicator = button.querySelector('.sort-indicator');
        if (indicator) indicator.textContent = nextDir === 'ascending' ? '▲' : '▼';
        const sorted = rows.slice().sort((a, b) => {
          const left = a.cells[dataIndex + 1]?.textContent || '';
          const right = b.cells[dataIndex + 1]?.textContent || '';
          const result = compareValues(left, right);
          return nextDir === 'ascending' ? result : -result;
        });
        sorted.forEach((row) => tbody.appendChild(row));
        rows.splice(0, rows.length, ...sorted);
        visibleRows();
        notifyTableChanged();
      });
    });
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

    const visibleChecks = () => rows
      .filter((row) => !row.hidden)
      .map((row) => row.querySelector('[data-print-select]'))
      .filter(Boolean);
    const update = () => {
      const selected = checks.filter((check) => check.checked);
      const visible = visibleChecks();
      const visibleSelected = visible.filter((check) => check.checked);
      if (printButton) printButton.disabled = selected.length === 0;
      actionButtons.forEach((button) => { button.disabled = selected.length === 0; });
      if (count) count.textContent = selected.length === 1 ? '1 ausgewählt' : selected.length + ' ausgewählt';
      if (selectAll) {
        selectAll.checked = visible.length > 0 && visibleSelected.length === visible.length;
        selectAll.indeterminate = visibleSelected.length > 0 && visibleSelected.length < visible.length;
        selectAll.disabled = visible.length === 0;
      }
    };

    checks.forEach((check) => check.addEventListener('change', update));
    container.addEventListener('results-table-updated', update);
    selectAll?.addEventListener('change', () => {
      visibleChecks().forEach((check) => { check.checked = selectAll.checked; });
      update();
    });
    printButton?.addEventListener('click', async () => {
      const currentRows = Array.from(container.querySelectorAll('[data-print-row]'));
      const selectedRows = currentRows.filter((row) => row.querySelector('[data-print-select]')?.checked);
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
    const fileArea = root.querySelector('[data-content-import-file-area]');
    const fileName = root.querySelector('[data-content-import-file-name]');
    const linkField = root.querySelector('[data-content-link-url-field]');
    const linkInput = root.querySelector('[data-content-link-url]');
    const submitButton = root.querySelector('[data-content-submit]');
    const nameLabel = root.querySelector('[data-content-name-label]');
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
    const setDialogMode = (mode) => {
      const isLink = mode === 'link';
      const isFolder = mode === 'folder';
      const usesFile = !isLink && !isFolder;
      if (fileArea) fileArea.hidden = !usesFile;
      if (fileName) fileName.hidden = !usesFile;
      if (fileInput) {
        fileInput.disabled = !usesFile;
        if (!usesFile) fileInput.value = '';
      }
      if (linkField) linkField.hidden = !isLink;
      if (linkInput) {
        linkInput.disabled = !isLink;
        linkInput.required = isLink;
        linkInput.value = '';
      }
      if (nameLabel) nameLabel.textContent = isFolder ? 'Ordnername' : 'Dateiname';
      if (submitButton) submitButton.textContent = isLink ? 'Verlinken' : isFolder ? 'Ordner erstellen' : 'Importieren';
    };
    const showDialog = () => {
      setError('');
      setMenu(false);
      if (dialog?.showModal) dialog.showModal();
      else dialog?.setAttribute('open', '');
    };
    const openDialog = (button) => {
      currentType = button.getAttribute('data-content-import') || '';
      setDialogMode('import');
      if (title) title.textContent = button.getAttribute('data-import-title') || 'Importieren';
      if (fileInput) fileInput.accept = button.getAttribute('data-import-accept') || '';
      if (nameInput) nameInput.value = '';
      setFile(null);
      showDialog();
    };
    const openLinkDialog = (button) => {
      currentType = 'link';
      setDialogMode('link');
      if (title) title.textContent = button.getAttribute('data-link-title') || 'Webseite verlinken';
      if (nameInput) nameInput.value = '';
      setFile(null);
      showDialog();
    };
    const openFolderDialog = (button) => {
      currentType = 'folder';
      setDialogMode('folder');
      if (title) title.textContent = button.getAttribute('data-folder-title') || 'Ordner erstellen';
      if (nameInput) nameInput.value = '';
      setFile(null);
      showDialog();
    };

    toggle?.addEventListener('click', (event) => {
      event.stopPropagation();
      setMenu(menu?.hidden !== false);
    });
    root.querySelectorAll('[data-content-import]').forEach((button) => button.addEventListener('click', () => openDialog(button)));
    root.querySelectorAll('[data-content-link]').forEach((button) => button.addEventListener('click', () => openLinkDialog(button)));
    root.querySelectorAll('[data-content-folder]').forEach((button) => button.addEventListener('click', () => openFolderDialog(button)));
    root.querySelectorAll('[data-content-import-close]').forEach((button) => {
      button.addEventListener('click', () => dialog?.close ? dialog.close() : dialog?.removeAttribute('open'));
    });
    fileInput?.addEventListener('change', () => setFile(fileInput.files?.[0]));
    dropzone?.addEventListener('click', () => {
      if (currentType === 'link') return;
      fileInput?.click();
    });
    dropzone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (currentType !== 'link') fileInput?.click();
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
      if (currentType !== 'link') setFile(event.dataTransfer?.files?.[0]);
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');
      const name = nameInput?.value?.trim() || '';
      if (!name) return setError('Bitte einen Dateinamen angeben.');
      const submit = form.querySelector('button[type="submit"]');
      const oldText = submit?.textContent;
      if (submit) {
        submit.disabled = true;
        submit.textContent = currentType === 'link' ? 'Speichere…' : currentType === 'folder' ? 'Erstelle…' : 'Importiere…';
      }
      try {
        let response;
        if (currentType === 'folder') {
          response = await fetch('/content-admin/' + encodeURIComponent(kachelId) + '/folder', {
            method: 'POST',
            body: new URLSearchParams({ dir, name }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            credentials: 'same-origin',
          });
        } else if (currentType === 'link') {
          const url = linkInput?.value?.trim() || '';
          if (!url) return setError('Bitte einen Link angeben.');
          response = await fetch('/content-admin/' + encodeURIComponent(kachelId) + '/link', {
            method: 'POST',
            body: new URLSearchParams({ dir, filename: name, url }),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            credentials: 'same-origin',
          });
        } else {
          if (!selectedFile) return setError('Bitte eine Datei auswählen.');
          const params = new URLSearchParams({ dir, type: currentType, name });
          response = await fetch('/content-admin/' + encodeURIComponent(kachelId) + '/import?' + params.toString(), {
            method: 'POST',
            body: selectedFile,
            headers: {
              'Content-Type': selectedFile.type || 'application/octet-stream',
              'X-Original-Filename': encodeURIComponent(selectedFile.name),
            },
            credentials: 'same-origin',
          });
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) throw new Error(data.error || (currentType === 'link' ? 'Verlinkung fehlgeschlagen.' : currentType === 'folder' ? 'Ordner konnte nicht erstellt werden.' : 'Import fehlgeschlagen.'));
        window.location.href = data.url || window.location.href;
      } catch (error) {
        setError(error?.message || (currentType === 'link' ? 'Verlinkung fehlgeschlagen.' : currentType === 'folder' ? 'Ordner konnte nicht erstellt werden.' : 'Import fehlgeschlagen.'));
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


function initContentEntryActions() {
  const postEntryAction = async (button, action, body) => {
    if (navigator.onLine === false) {
      window.alert('Diese Funktion benötigt eine Verbindung zum Server.');
      return;
    }
    const kachelId = button.getAttribute('data-content-kachel-id');
    if (!kachelId) return;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = action === 'rename' ? 'Speichere…' : 'Lösche…';
    try {
      const response = await fetch('/content-admin/' + encodeURIComponent(kachelId) + '/entry/' + action, {
        method: 'POST',
        body: new URLSearchParams(body),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || 'Aktion fehlgeschlagen.');
      window.location.href = data.url || window.location.href;
    } catch (error) {
      window.alert(error?.message || 'Aktion fehlgeschlagen.');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  };

  document.querySelectorAll('[data-content-entry-rename]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rel = button.getAttribute('data-content-rel') || '';
      const currentName = button.getAttribute('data-content-name') || '';
      const nextName = window.prompt('Neuer Name', currentName);
      if (nextName === null) return;
      const trimmed = nextName.trim();
      if (!trimmed) {
        window.alert('Bitte einen Namen angeben.');
        return;
      }
      postEntryAction(button, 'rename', { rel, name: trimmed });
    });
  });

  document.querySelectorAll('[data-content-entry-delete]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rel = button.getAttribute('data-content-rel') || '';
      const name = button.getAttribute('data-content-name') || rel;
      if (!window.confirm('Eintrag wirklich löschen?\n' + name)) return;
      postEntryAction(button, 'delete', { rel });
    });
  });
}

function initQuizBuilder() {
  const root = document.querySelector('[data-quiz-builder]');
  if (!root) return;
  const form = root.querySelector('[data-quiz-builder-form]');
  const titleInput = root.querySelector('[data-quiz-title]');
  const questionsEl = root.querySelector('[data-quiz-questions]');
  const addQuestionButton = root.querySelector('[data-quiz-add-question]');
  const errorEl = root.querySelector('[data-quiz-error]');
  const submitUrl = form?.getAttribute('data-quiz-submit-url') || '/quiz';
  const relDir = form?.getAttribute('data-quiz-dir') || '';
  let questionSeq = 0;

  const setError = (message) => {
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  };

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

  const renumber = () => {
    Array.from(questionsEl.querySelectorAll('[data-quiz-question]')).forEach((question, index) => {
      const label = question.querySelector('[data-question-number]');
      if (label) label.textContent = String(index + 1);
      const remove = question.querySelector('[data-quiz-remove-question]');
      if (remove) remove.hidden = questionsEl.querySelectorAll('[data-quiz-question]').length <= 1;
    });
  };

  const answerInputType = (question) => {
    const type = question.querySelector('[data-quiz-type]')?.value || 'single';
    if (type === 'multiple') return 'checkbox';
    return 'radio';
  };

  const addAnswer = (question, text = '', correct = false) => {
    const answers = question.querySelector('[data-quiz-answers]');
    const type = answerInputType(question);
    const row = document.createElement('div');
    row.className = 'quiz-answer';
    row.setAttribute('data-quiz-answer', '');
    row.innerHTML =
      '<label class="quiz-correct-marker" title="Richtige Antwort">' +
        '<input data-quiz-correct type="' + type + '" name="correct-' + question.dataset.qid + '"' + (correct ? ' checked' : '') + '>' +
        '<span>richtig</span>' +
      '</label>' +
      '<input data-quiz-answer-text placeholder="Antwort" value="' + escapeHtml(text) + '">' +
      '<button type="button" class="secondary-button compact" data-quiz-remove-answer>Entfernen</button>';
    answers.appendChild(row);
    row.querySelector('[data-quiz-remove-answer]')?.addEventListener('click', () => {
      row.remove();
      const remaining = answers.querySelectorAll('[data-quiz-answer]');
      if (!remaining.length) addAnswer(question, '', true);
    });
    return row;
  };

  const syncQuestionType = (question) => {
    const type = question.querySelector('[data-quiz-type]')?.value || 'single';
    const answersWrap = question.querySelector('[data-quiz-answers-wrap]');
    const addAnswerButton = question.querySelector('[data-quiz-add-answer]');
    const answers = question.querySelector('[data-quiz-answers]');
    const freeText = type === 'free_text';
    if (answersWrap) answersWrap.hidden = freeText;
    if (addAnswerButton) addAnswerButton.hidden = freeText;
    answers.querySelectorAll('[data-quiz-correct]').forEach((input, index) => {
      input.type = type === 'multiple' ? 'checkbox' : 'radio';
      input.name = 'correct-' + question.dataset.qid;
      if (type === 'single' && index === 0 && !answers.querySelector('[data-quiz-correct]:checked')) input.checked = true;
    });
  };

  const setImageFile = (question, file, fileInput = null) => {
    const preview = question.querySelector('[data-quiz-image-preview]');
    const imageName = question.querySelector('[data-quiz-image-name]');
    question._imageData = '';
    if (imageName) imageName.textContent = file ? file.name : 'Kein Bild ausgewählt.';
    if (!file) {
      if (preview) preview.hidden = true;
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Bitte ein Bild auswählen.');
      if (fileInput) fileInput.value = '';
      if (imageName) imageName.textContent = 'Kein Bild ausgewählt.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Bilder dürfen maximal 5 MB gross sein.');
      if (fileInput) fileInput.value = '';
      if (imageName) imageName.textContent = 'Kein Bild ausgewählt.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      question._imageData = String(reader.result || '');
      if (preview) {
        preview.hidden = false;
        preview.innerHTML = '<img src="' + escapeHtml(question._imageData) + '" alt="Vorschau">';
      }
    };
    reader.readAsDataURL(file);
  };

  const addQuestion = () => {
    questionSeq += 1;
    const qid = String(questionSeq);
    const question = document.createElement('section');
    question.className = 'quiz-question';
    question.setAttribute('data-quiz-question', '');
    question.dataset.qid = qid;
    question.innerHTML =
      '<div class="quiz-question-head">' +
        '<h2>Frage <span data-question-number></span></h2>' +
        '<button type="button" class="secondary-button compact" data-quiz-remove-question>Frage entfernen</button>' +
      '</div>' +
      '<label class="field">Frage *<textarea data-quiz-question-text rows="3" required></textarea></label>' +
      '<div class="field quiz-image-import">' +
        '<span>Bild optional</span>' +
        '<div class="content-dropzone quiz-image-dropzone" data-quiz-image-dropzone tabindex="0">' +
          '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-quiz-image hidden>' +
          '<strong>Bild hier ablegen oder klicken</strong>' +
          '<span>PNG, JPG, WebP oder GIF · maximal 5 MB</span>' +
        '</div>' +
        '<p class="muted" data-quiz-image-name>Kein Bild ausgewählt.</p>' +
        '<div class="quiz-image-preview" data-quiz-image-preview hidden></div>' +
      '</div>' +
      '<label class="field">Antworttyp *<select data-quiz-type>' +
        '<option value="single">Single Choice</option>' +
        '<option value="multiple">Multiple Choice</option>' +
        '<option value="free_text">Freitext</option>' +
      '</select></label>' +
      '<div data-quiz-answers-wrap>' +
        '<div class="quiz-answers" data-quiz-answers></div>' +
        '<button type="button" class="secondary-button compact" data-quiz-add-answer>+ Antwort hinzufügen</button>' +
      '</div>';
    questionsEl.appendChild(question);
    addAnswer(question, '', true);

    question.querySelector('[data-quiz-remove-question]')?.addEventListener('click', () => {
      question.remove();
      if (!questionsEl.querySelector('[data-quiz-question]')) addQuestion();
      renumber();
    });
    question.querySelector('[data-quiz-add-answer]')?.addEventListener('click', () => addAnswer(question));
    question.querySelector('[data-quiz-type]')?.addEventListener('change', () => syncQuestionType(question));
    const imageInput = question.querySelector('[data-quiz-image]');
    const imageDropzone = question.querySelector('[data-quiz-image-dropzone]');
    imageInput?.addEventListener('change', (event) => setImageFile(question, event.target.files?.[0], imageInput));
    imageDropzone?.addEventListener('click', () => imageInput?.click());
    imageDropzone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        imageInput?.click();
      }
    });
    ['dragenter', 'dragover'].forEach((name) => {
      imageDropzone?.addEventListener(name, (event) => {
        event.preventDefault();
        imageDropzone.classList.add('is-dragging');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      imageDropzone?.addEventListener(name, () => imageDropzone.classList.remove('is-dragging'));
    });
    imageDropzone?.addEventListener('drop', (event) => {
      event.preventDefault();
      setImageFile(question, event.dataTransfer?.files?.[0], imageInput);
    });
    syncQuestionType(question);
    renumber();
  };

  const collectPayload = () => {
    const title = titleInput?.value?.trim() || '';
    if (!title) throw new Error('Bitte einen Quiz-Titel angeben.');
    const questions = Array.from(questionsEl.querySelectorAll('[data-quiz-question]')).map((question, index) => {
      const type = question.querySelector('[data-quiz-type]')?.value || 'single';
      const text = question.querySelector('[data-quiz-question-text]')?.value?.trim() || '';
      if (!text) throw new Error('Frage ' + (index + 1) + ': Bitte eine Frage angeben.');
      if (type === 'free_text') return { text, type, answers: [], imageData: question._imageData || '' };
      const answers = Array.from(question.querySelectorAll('[data-quiz-answer]')).map((row) => ({
        text: row.querySelector('[data-quiz-answer-text]')?.value?.trim() || '',
        correct: Boolean(row.querySelector('[data-quiz-correct]')?.checked),
      })).filter((answer) => answer.text);
      if (!answers.length) throw new Error('Frage ' + (index + 1) + ': Bitte mindestens eine Antwort angeben.');
      const correct = answers.filter((answer) => answer.correct);
      if (type === 'single' && correct.length !== 1) throw new Error('Frage ' + (index + 1) + ': Genau eine richtige Antwort markieren.');
      if (type === 'multiple' && correct.length < 1) throw new Error('Frage ' + (index + 1) + ': Mindestens eine richtige Antwort markieren.');
      return { text, type, answers, imageData: question._imageData || '' };
    });
    return { title, dir: relDir, questions };
  };

  addQuestionButton?.addEventListener('click', addQuestion);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    const submit = form.querySelector('button[type="submit"]');
    const oldText = submit?.textContent;
    try {
      const payload = collectPayload();
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Speichere…';
      }
      const response = await fetch(submitUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || 'Quiz konnte nicht erstellt werden.');
      window.location.href = data.url || '/k/quiz';
    } catch (error) {
      setError(error?.message || 'Quiz konnte nicht erstellt werden.');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = oldText;
      }
    }
  });

  addQuestion();
}

function initGlobalSearch() {
  const root = document.querySelector('[data-global-search]');
  if (!root) return;

  const toggle = root.querySelector('[data-global-search-toggle]');
  const panel = root.querySelector('[data-global-search-panel]');
  const form = root.querySelector('[data-global-search-form]');
  const input = root.querySelector('[data-global-search-input]');
  const status = root.querySelector('[data-global-search-status]');
  const results = root.querySelector('[data-global-search-results]');
  let timer = null;
  let controller = null;

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

  const setOpen = (open) => {
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Suche schließen' : 'Suche öffnen');
    root.classList.toggle('is-open', open);
    if (open) setTimeout(() => input?.focus(), 0);
  };

  const setStatus = (message) => {
    if (status) status.textContent = message || '';
  };

  const renderResults = (items) => {
    if (!results) return;
    if (!items.length) {
      results.innerHTML = '<p class="global-search-empty">Keine Treffer.</p>';
      return;
    }
    results.innerHTML = items.map((item) => {
      const target = item.external ? ' target="_blank" rel="noopener"' : '';
      const snippet = item.snippet ? '<p>' + escapeHtml(item.snippet) + '</p>' : '';
      return '<a class="global-search-result" href="' + escapeHtml(item.url) + '"' + target + '>' +
        '<span class="global-search-result-title">' + escapeHtml(item.title) + '</span>' +
        '<span class="global-search-result-meta">' + escapeHtml(item.kachelTitle) + ' · ' + escapeHtml(item.kind) + '</span>' +
        snippet +
      '</a>';
    }).join('');
  };

  const runSearch = async () => {
    const query = input?.value?.trim() || '';
    if (query.length < 2) {
      controller?.abort();
      renderResults([]);
      setStatus('Mindestens 2 Zeichen eingeben.');
      return;
    }
    if (navigator.onLine === false) {
      renderResults([]);
      setStatus('Suche ist offline nicht verfügbar.');
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setStatus('Suche läuft…');
    try {
      const response = await fetch('/api/search?q=' + encodeURIComponent(query), {
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Suche fehlgeschlagen.');
      const data = await response.json();
      renderResults(Array.isArray(data.results) ? data.results : []);
      setStatus((data.results?.length || 0) + ' Treffer');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      renderResults([]);
      setStatus(error?.message || 'Suche fehlgeschlagen.');
    }
  };

  const scheduleSearch = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(runSearch, 220);
  };

  toggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(panel?.hidden !== false);
  });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });
  input?.addEventListener('input', scheduleSearch);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) setOpen(false);
  });
}


function initFormBuilder() {
  const form = document.querySelector('[data-form-builder]');
  if (!form) return;
  const fieldsRoot = form.querySelector('[data-form-builder-fields]');
  const hidden = form.querySelector('[data-form-builder-fields-json]');
  const addButton = form.querySelector('[data-form-builder-add]');
  let fieldSeq = 0;

  const escHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

  const syncOptionsVisibility = (row) => {
    const type = row.querySelector('[data-form-field-type]')?.value || 'text';
    const options = row.querySelector('[data-form-field-options-wrap]');
    if (options) options.hidden = !['select', 'radio', 'checkboxes'].includes(type);
  };

  const renumber = () => {
    Array.from(fieldsRoot.querySelectorAll('[data-form-builder-field]')).forEach((row, index) => {
      const number = row.querySelector('[data-form-builder-field-number]');
      if (number) number.textContent = String(index + 1);
      const remove = row.querySelector('[data-form-builder-remove]');
      if (remove) remove.hidden = fieldsRoot.querySelectorAll('[data-form-builder-field]').length <= 1;
    });
  };

  const addField = (initial = {}) => {
    fieldSeq += 1;
    const row = document.createElement('section');
    row.className = 'form-builder-field';
    row.setAttribute('data-form-builder-field', '');
    row.innerHTML =
      '<div class="quiz-question-head">' +
        '<h3>Feld <span data-form-builder-field-number></span></h3>' +
        '<button type="button" class="secondary-button compact" data-form-builder-remove>Feld entfernen</button>' +
      '</div>' +
      '<div class="field-row">' +
        '<label class="field">Bezeichnung *<input data-form-field-label required value="' + escHtml(initial.label || '') + '"></label>' +
        '<label class="field">Typ<select data-form-field-type>' +
          '<option value="text">Text</option>' +
          '<option value="textarea">Freitext</option>' +
          '<option value="number">Zahl</option>' +
          '<option value="date">Datum</option>' +
          '<option value="time">Zeit</option>' +
          '<option value="select">Dropdown</option>' +
          '<option value="radio">Single Choice</option>' +
          '<option value="checkboxes">Mehrfachauswahl</option>' +
          '<option value="checkbox">Checkbox</option>' +
        '</select></label>' +
      '</div>' +
      '<label class="checkbox"><input type="checkbox" data-form-field-required' + (initial.required ? ' checked' : '') + '> Pflichtfeld</label>' +
      '<label class="field" data-form-field-options-wrap hidden>Optionen, eine pro Zeile<textarea data-form-field-options rows="4">' + escHtml((initial.options || []).join('\n')) + '</textarea></label>';
    fieldsRoot.appendChild(row);
    const typeSelect = row.querySelector('[data-form-field-type]');
    if (initial.type) typeSelect.value = initial.type;
    typeSelect.addEventListener('change', () => syncOptionsVisibility(row));
    row.querySelector('[data-form-builder-remove]')?.addEventListener('click', () => {
      row.remove();
      if (!fieldsRoot.querySelector('[data-form-builder-field]')) addField();
      renumber();
    });
    syncOptionsVisibility(row);
    renumber();
  };

  const collectFields = () => Array.from(fieldsRoot.querySelectorAll('[data-form-builder-field]')).map((row, index) => {
    const label = row.querySelector('[data-form-field-label]')?.value?.trim() || '';
    if (!label) throw new Error('Feld ' + (index + 1) + ': Bitte eine Bezeichnung angeben.');
    const type = row.querySelector('[data-form-field-type]')?.value || 'text';
    const field = {
      label,
      type,
      required: Boolean(row.querySelector('[data-form-field-required]')?.checked),
    };
    if (['select', 'radio', 'checkboxes'].includes(type)) {
      field.options = (row.querySelector('[data-form-field-options]')?.value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (field.options.length < 2) throw new Error('Feld ' + (index + 1) + ': Bitte mindestens zwei Optionen angeben.');
    }
    return field;
  });

  addButton?.addEventListener('click', () => addField());
  form.addEventListener('submit', (event) => {
    try {
      const fields = collectFields();
      if (!fields.length) throw new Error('Bitte mindestens ein Feld erfassen.');
      hidden.value = JSON.stringify(fields);
    } catch (error) {
      event.preventDefault();
      window.alert(error?.message || 'Formular ist unvollständig.');
    }
  });

  let restored = false;
  try {
    const values = hidden?.value ? JSON.parse(hidden.value) : [];
    if (Array.isArray(values) && values.length) {
      values.forEach(addField);
      restored = true;
    }
  } catch {}
  if (!restored) addField();
}

function initMarkdownEditor() {
  const root = document.querySelector('[data-markdown-editor-page]');
  if (!root) return;
  const textarea = root.querySelector('[data-markdown-editor]');
  const preview = root.querySelector('[data-markdown-preview]');
  const form = root.querySelector('[data-markdown-editor-form]');
  const hiddenImages = root.querySelector('[data-markdown-images-json]');
  const imageInput = root.querySelector('[data-markdown-image-file]');
  const imageDropzone = root.querySelector('[data-markdown-image-dropzone]');
  const imageStatus = root.querySelector('[data-markdown-image-status]');
  const imageList = root.querySelector('[data-markdown-image-list]');
  if (!textarea || !preview) return;
  const pendingImages = [];
  let imageSeq = 0;

  const htmlEscape = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
  const inline = (value) => htmlEscape(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
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
  const renderImageList = () => {
    if (!imageList) return;
    imageList.innerHTML = pendingImages.map((image, index) =>
      '<div class="markdown-image-item">' +
        '<img src="' + htmlEscape(image.data) + '" alt="Vorschau">' +
        '<span>' + htmlEscape(image.name) + '</span>' +
        '<button type="button" class="secondary-button compact" data-md-remove-image="' + index + '">Entfernen</button>' +
      '</div>'
    ).join('');
    imageList.querySelectorAll('[data-md-remove-image]').forEach((button) => {
      button.addEventListener('click', () => {
        const image = pendingImages[Number(button.getAttribute('data-md-remove-image'))];
        if (image) {
          textarea.value = textarea.value.split(image.token).join('');
          pendingImages.splice(pendingImages.indexOf(image), 1);
          renderImageList();
          renderPreview();
        }
      });
    });
  };
  const insertImageFile = (file) => {
    setMarkdownImageStatus('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMarkdownImageStatus('Bitte ein Bild auswählen.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMarkdownImageStatus('Bilder dürfen maximal 5 MB gross sein.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      imageSeq += 1;
      const token = '__MARKDOWN_IMAGE_' + Date.now() + '_' + imageSeq + '__';
      const alt = file.name.replace(/\.[^.]+$/, '') || 'Bild';
      pendingImages.push({ token, name: file.name, data: String(reader.result || '') });
      replaceSelection('![' + alt + '](' + token + ')');
      if (imageStatus) imageStatus.textContent = file.name + ' eingefügt.';
      renderImageList();
    };
    reader.readAsDataURL(file);
  };
  const setMarkdownImageStatus = (message) => {
    if (imageStatus) imageStatus.textContent = message || 'Kein Bild ausgewählt.';
  };
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
  root.querySelector('[data-md-image-trigger]')?.addEventListener('click', () => imageInput?.click());
  imageInput?.addEventListener('change', () => {
    insertImageFile(imageInput.files?.[0]);
    imageInput.value = '';
  });
  imageDropzone?.addEventListener('click', () => imageInput?.click());
  imageDropzone?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      imageInput?.click();
    }
  });
  ['dragenter', 'dragover'].forEach((name) => {
    imageDropzone?.addEventListener(name, (event) => {
      event.preventDefault();
      imageDropzone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    imageDropzone?.addEventListener(name, () => imageDropzone.classList.remove('is-dragging'));
  });
  imageDropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    insertImageFile(event.dataTransfer?.files?.[0]);
  });
  form?.addEventListener('submit', () => {
    if (hiddenImages) hiddenImages.value = JSON.stringify(pendingImages);
  });
  textarea.addEventListener('input', renderPreview);
  renderPreview();
}

initThemeSelector();
initEnhancedForms();
initContentActions();
initContentEntryActions();
initQuizBuilder();
initGlobalSearch();
initFormBuilder();
initMarkdownEditor();
initResultsTables();
initResultPrinting();
