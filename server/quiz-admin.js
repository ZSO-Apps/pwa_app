import fs from 'node:fs';
import path from 'node:path';
import { findKachel, getForm, loadLayout } from './layout.js';
import { hasAccess } from './auth.js';
import { effectiveKachel, resolveKachelPath, safeResolve } from './content.js';
import { layout } from './templates/layout.js';
import { esc } from './templates/shared.js';
import { renderError } from './templates/index.js';

const DEFAULT_QUIZ_KACHEL_ID = 'quiz';
const QUIZ_CREATOR_ROLE = 'Unteroffizier';
const ZSO_CONTENT_ROOT = path.resolve('content_zso_specific');
const CONTENT_ROOTS = [path.resolve('content_generic'), ZSO_CONTENT_ROOT];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FIELD_WIDTHS = new Set(['half', 'third']);
const DISPLAY_QUESTION_TYPES = new Set(['heading', 'paragraph', 'image']);

function canManageQuiz(req, kachel) {
  return Boolean(kachel?.content && hasAccess(req.user?.role || 'public', QUIZ_CREATOR_ROLE));
}

function requireManageQuiz(req, res, kachel) {
  if (!kachel?.content) {
    res.status(404).send(renderError(req, 404, 'Quiz-Verwaltung nicht verfügbar'));
    return false;
  }
  if (canManageQuiz(req, kachel)) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

export function quizActionContext(_req, _kachel) {
  return null;
}

function normalizeRelDir(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('Ungültiger Ordner.');
  return parts.join('/');
}

function encodedRelPath(relDir) {
  return normalizeRelDir(relDir).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function folderUrl(kachelId, relDir = '') {
  const rel = encodedRelPath(relDir);
  return '/k/' + encodeURIComponent(kachelId) + (rel ? '/' + rel + '/' : '');
}

function effectiveContentKachel(kachel, activeWk) {
  const effective = effectiveKachel(kachel, activeWk);
  if (!effective?.content) throw new Error('Bitte zuerst einen WK auswählen oder anlegen.');
  return effective;
}

function zsoRootFor(kachel) {
  return path.join(ZSO_CONTENT_ROOT, kachel.content);
}

function targetDirFor(kachel, relDir, activeWk) {
  const effective = effectiveContentKachel(kachel, activeWk);
  const rel = normalizeRelDir(relDir);
  if (rel) {
    const existing = resolveKachelPath(effective, rel);
    if (!existing || !fs.existsSync(existing) || !fs.statSync(existing).isDirectory()) {
      throw new Error('Ordner nicht gefunden.');
    }
  }
  return safeResolve(zsoRootFor(effective), rel);
}

function contentAssetUrl(kachelId, relDir, assetDirName, fileName) {
  const parts = normalizeRelDir(relDir).split('/').filter(Boolean);
  parts.push(assetDirName, fileName);
  return '/k/' + encodeURIComponent(kachelId) + '/' + parts.map((part) => encodeURIComponent(part)).join('/');
}

function slugify(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'quiz';
}

function safeFileBase(value) {
  let base = String(value || '').trim();
  base = base.replace(/\.(json|md|markdown|txt|pdf|png|jpe?g|gif|webp|url)$/i, '');
  base = base
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%{}^~[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  if (!base) throw new Error('Bitte einen Quiz-Titel angeben.');
  return base;
}

function contentFolderName(title) {
  return safeFileBase(title) + '.content';
}

function formFileExists(formId, targetDir) {
  if (getForm(formId)) return true;
  if (fs.existsSync(path.join(targetDir, formId + '.json'))) return true;

  for (const root of CONTENT_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name.toLowerCase().endsWith('.content')) continue;
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(child);
        else if (entry.name === formId + '.json') return true;
      }
    }
  }
  return false;
}

function uniqueFormId(title, targetDir) {
  const base = 'quiz-' + slugify(title).replace(/^quiz-/, '');
  let candidate = base;
  for (let n = 2; formFileExists(candidate, targetDir); n++) {
    candidate = base + '-' + n;
  }
  return candidate;
}

function decodeImage(dataUrl) {
  const value = String(dataUrl || '');
  if (!value) return null;
  const match = value.match(/^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Bildformat nicht unterstützt.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Bild ist leer.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Bilder dürfen maximal 5 MB gross sein.');
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  return { buffer, ext: ext === 'jpg' ? 'jpg' : ext };
}

function ensureUniqueAnswers(question, index) {
  const seen = new Set();
  for (const answer of question.answers) {
    const key = answer.text.toLocaleLowerCase('de-CH');
    if (seen.has(key)) throw new Error('Frage ' + index + ': Antworten müssen eindeutig sein.');
    seen.add(key);
  }
}

function normalizePayload(body) {
  const title = String(body?.title || '').trim();
  if (!title) throw new Error('Bitte einen Quiz-Titel angeben.');
  const rawQuestions = Array.isArray(body?.questions) ? body.questions : [];
  if (!rawQuestions.length) throw new Error('Bitte mindestens eine Frage erfassen.');

  const questions = rawQuestions.map((raw, idx) => {
    const number = idx + 1;
    const text = String(raw?.text || '').trim();
    if (!text) throw new Error('Frage ' + number + ': Bitte eine Frage angeben.');
    const type = String(raw?.type || 'single');
    if (!['single', 'multiple', 'free_text', 'heading', 'paragraph', 'image'].includes(type)) {
      throw new Error('Frage ' + number + ': Typ ist ungültig.');
    }

    const width = FIELD_WIDTHS.has(String(raw?.width || '')) ? String(raw.width) : '';
    const compact = Boolean(raw?.compact);
    const imageData = raw?.imageData || '';

    if (DISPLAY_QUESTION_TYPES.has(type)) {
      if (type === 'image' && !imageData) throw new Error('Frage ' + number + ': Bitte ein Bild auswählen.');
      return { text, type, answers: [], imageData, width };
    }

    if (type === 'free_text') {
      return { text, type, answers: [], imageData, width, compact };
    }

    const rawAnswers = Array.isArray(raw?.answers) ? raw.answers : [];
    const answers = rawAnswers
      .map((answer) => ({
        text: String(answer?.text || '').trim(),
        correct: Boolean(answer?.correct),
      }))
      .filter((answer) => answer.text);
    if (!answers.length) throw new Error('Frage ' + number + ': Bitte mindestens eine Antwort angeben.');
    ensureUniqueAnswers({ answers }, number);

    const correct = answers.filter((answer) => answer.correct);
    if (type === 'single' && correct.length !== 1) {
      throw new Error('Frage ' + number + ': Bei Single Choice muss genau eine richtige Antwort markiert sein.');
    }
    if (type === 'multiple' && correct.length < 1) {
      throw new Error('Frage ' + number + ': Bei Multiple Choice muss mindestens eine richtige Antwort markiert sein.');
    }

    return { text, type, answers, imageData, width, compact };
  });

  return { title, questions };
}

function writeQuestionImage(payload, formId, index, imageData, targetDir, kachelId, relDir) {
  const decoded = decodeImage(imageData);
  if (!decoded) return '';
  const assetDirName = contentFolderName(payload.title);
  const assetDir = safeResolve(targetDir, assetDirName);
  fs.mkdirSync(assetDir, { recursive: true });
  const fileName = formId + '-frage-' + index + '.' + decoded.ext;
  const target = safeResolve(assetDir, fileName);
  fs.writeFileSync(target, decoded.buffer);
  return contentAssetUrl(kachelId, relDir, assetDirName, fileName);
}

function quizDefinitionFromPayload(payload, formId, targetDir, kachelId, relDir) {
  const fields = [];
  payload.questions.forEach((question, idx) => {
    const number = idx + 1;

    if (DISPLAY_QUESTION_TYPES.has(question.type)) {
      const field = question.type === 'paragraph'
        ? { type: 'paragraph', label: question.text, text: question.text }
        : { type: question.type, label: question.text };
      if (question.type === 'image') {
        const image = writeQuestionImage(payload, formId, number, question.imageData, targetDir, kachelId, relDir);
        if (!image) throw new Error('Frage ' + number + ': Bitte ein Bild auswählen.');
        field.image = image;
      }
      if (FIELD_WIDTHS.has(question.width)) field.width = question.width;
      fields.push(field);
      return;
    }

    const field = {
      name: 'frage' + number,
      type: question.type === 'multiple' ? 'checkboxes' : question.type === 'free_text' ? 'textarea' : 'radio',
      label: question.text,
      required: true,
    };
    const image = writeQuestionImage(payload, formId, number, question.imageData, targetDir, kachelId, relDir);
    if (image) field.image = image;
    if (FIELD_WIDTHS.has(question.width)) field.width = question.width;
    if (question.compact) field.compact = true;
    if (question.type !== 'free_text') {
      field.options = question.answers.map((answer) => answer.text);
      const correct = question.answers.filter((answer) => answer.correct).map((answer) => answer.text);
      field.correct = question.type === 'single' ? correct[0] : correct;
    }
    fields.push(field);
  });

  return {
    id: formId,
    title: 'Quiz ' + payload.title,
    submitLabel: 'Quiz ' + payload.title,
    resultsLabel: 'Quiz-Auswertung ' + payload.title,
    submitAccess: 'Soldat',
    resultsAccess: 'Unteroffizier',
    quiz: true,
    fields,
  };
}

export function renderNewQuiz(req, res, kachelId = DEFAULT_QUIZ_KACHEL_ID) {
  const kachel = findKachel(kachelId);
  if (!requireManageQuiz(req, res, kachel)) return;

  let relDir = '';
  try {
    relDir = normalizeRelDir(req.query?.dir);
    targetDirFor(kachel, relDir, req.activeWk);
  } catch (error) {
    return res.status(400).send(renderError(req, 400, error.message));
  }

  const backUrl = folderUrl(kachel.id, relDir);
  const submitUrl = '/content-admin/' + encodeURIComponent(kachel.id) + '/quiz';
  const context = relDir ? ' im Ordner <strong>' + esc(relDir) + '</strong>' : ' in dieser Kachel';
  const body = [
    '<article class="content quiz-builder" data-quiz-builder>',
    '<p><a href="' + esc(backUrl) + '" class="back">← Zurück</a></p>',
    '<div class="content-header"><h1>Quiz hinzufügen</h1></div>',
    '<p class="muted">Erstellt eine neue Quiz-Definition' + context + '. Danach erscheinen automatisch die Ausfüllmöglichkeit und die Auswertung in der aktuellen Übersicht.</p>',
    '<form class="quiz-builder-form" data-online-only-form data-quiz-builder-form data-quiz-submit-url="' + esc(submitUrl) + '" data-quiz-dir="' + esc(relDir) + '">',
    '<label class="field quiz-title-field">Quiz-Titel *<input name="title" data-quiz-title required autocomplete="off" placeholder="z.B. Kabel"></label>',
    '<div class="quiz-questions" data-quiz-questions></div>',
    '<button type="button" class="secondary-button" data-quiz-add-question>+ Frage hinzufügen</button>',
    '<p class="err" data-quiz-error hidden></p>',
    '<div class="dialog-actions quiz-builder-submit"><a class="secondary-button" href="' + esc(backUrl) + '">Abbrechen</a><button type="submit" data-online-only="true">Quiz erstellen</button></div>',
    '</form>',
    '</article>',
  ].join('');
  res.send(layout(req, { title: 'Quiz hinzufügen', body }));
}

export function createQuiz(req, res, kachelId = DEFAULT_QUIZ_KACHEL_ID) {
  const kachel = findKachel(kachelId);
  if (!requireManageQuiz(req, res, kachel)) return;

  let relDir = '';
  try {
    relDir = normalizeRelDir(req.body?.dir);
    const targetDir = targetDirFor(kachel, relDir, req.activeWk);
    const payload = normalizePayload(req.body || {});
    const formId = uniqueFormId(payload.title, targetDir);
    const definition = quizDefinitionFromPayload(payload, formId, targetDir, kachel.id, relDir);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, formId + '.json'), JSON.stringify(definition, null, 2) + '\n');
    loadLayout();
    res.json({ ok: true, url: folderUrl(kachel.id, relDir), id: formId });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'Quiz konnte nicht erstellt werden.' });
  }
}
