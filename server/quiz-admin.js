import fs from 'node:fs';
import path from 'node:path';
import { findKachel, loadLayout } from './layout.js';
import { hasAccess } from './auth.js';
import { safeResolve } from './content.js';
import { layout } from './templates/layout.js';
import { esc } from './templates/shared.js';
import { renderError } from './templates/index.js';

const QUIZ_KACHEL_ID = 'quiz';
const QUIZ_CREATOR_ROLE = 'Unteroffizier';
const QUIZ_ROOT = path.resolve('content_zso_specific/quiz');
const QUIZ_GENERIC_ROOT = path.resolve('content_generic/quiz');
const QUIZ_ASSET_DIR = path.join(QUIZ_ROOT, '.assets');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function canManageQuiz(req) {
  return hasAccess(req.user?.role || 'public', QUIZ_CREATOR_ROLE);
}

function requireManageQuiz(req, res) {
  if (canManageQuiz(req)) return true;
  if (!req.user) {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return false;
  }
  res.status(403).send(renderError(req, 403, 'Zugriff verweigert'));
  return false;
}

export function quizActionContext(req, kachel) {
  if (kachel?.id !== QUIZ_KACHEL_ID || !canManageQuiz(req)) return null;
  return { enabled: true };
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

function uniqueFormId(title) {
  const base = 'quiz-' + slugify(title).replace(/^quiz-/, '');
  let candidate = base;
  for (let n = 2; formFileExists(candidate); n++) {
    candidate = base + '-' + n;
  }
  return candidate;
}

function formFileExists(formId) {
  return fs.existsSync(path.join(QUIZ_ROOT, formId + '.json'))
    || fs.existsSync(path.join(QUIZ_GENERIC_ROOT, formId + '.json'));
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
    if (!['single', 'multiple', 'free_text'].includes(type)) {
      throw new Error('Frage ' + number + ': Antworttyp ist ungültig.');
    }

    if (type === 'free_text') {
      return { text, type, answers: [], imageData: raw?.imageData || '' };
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

    return { text, type, answers, imageData: raw?.imageData || '' };
  });

  return { title, questions };
}

function writeQuestionImage(formId, index, imageData) {
  const decoded = decodeImage(imageData);
  if (!decoded) return '';
  fs.mkdirSync(QUIZ_ASSET_DIR, { recursive: true });
  const fileName = formId + '-frage-' + index + '.' + decoded.ext;
  const target = safeResolve(QUIZ_ASSET_DIR, fileName);
  fs.writeFileSync(target, decoded.buffer);
  return '/k/quiz/.assets/' + encodeURIComponent(fileName);
}

function quizDefinitionFromPayload(payload, formId) {
  const fields = [];
  payload.questions.forEach((question, idx) => {
    const number = idx + 1;
    const field = {
      name: 'frage' + number,
      type: question.type === 'multiple' ? 'checkboxes' : question.type === 'free_text' ? 'textarea' : 'radio',
      label: question.text,
      required: true,
    };
    const image = writeQuestionImage(formId, number, question.imageData);
    if (image) field.image = image;
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

export function renderNewQuiz(req, res) {
  if (!requireManageQuiz(req, res)) return;
  const kachel = findKachel(QUIZ_KACHEL_ID);
  if (!kachel) return res.status(404).send(renderError(req, 404, 'Quiz-Kachel nicht gefunden'));
  const body = [
    '<article class="content quiz-builder" data-quiz-builder>',
    '<p><a href="/k/quiz" class="back">← Zurück</a></p>',
    '<div class="content-header"><h1>Quiz hinzufügen</h1></div>',
    '<p class="muted">Erstellt eine neue Quiz-Definition. Danach erscheinen automatisch die Ausfüllmöglichkeit und die Auswertung in der Quiz-Kachel.</p>',
    '<form class="quiz-builder-form" data-quiz-builder-form>',
    '<label class="field quiz-title-field">Quiz-Titel *<input name="title" data-quiz-title required autocomplete="off" placeholder="z.B. Kabel"></label>',
    '<div class="quiz-questions" data-quiz-questions></div>',
    '<button type="button" class="secondary-button" data-quiz-add-question>+ Frage hinzufügen</button>',
    '<p class="err" data-quiz-error hidden></p>',
    '<div class="dialog-actions quiz-builder-submit"><a class="secondary-button" href="/k/quiz">Abbrechen</a><button type="submit">Quiz erstellen</button></div>',
    '</form>',
    '</article>',
  ].join('');
  res.send(layout(req, { title: 'Quiz hinzufügen', body }));
}

export function createQuiz(req, res) {
  if (!requireManageQuiz(req, res)) return;
  try {
    const payload = normalizePayload(req.body || {});
    const formId = uniqueFormId(payload.title);
    const definition = quizDefinitionFromPayload(payload, formId);
    fs.mkdirSync(QUIZ_ROOT, { recursive: true });
    fs.writeFileSync(path.join(QUIZ_ROOT, formId + '.json'), JSON.stringify(definition, null, 2) + '\n');
    loadLayout();
    res.json({ ok: true, url: '/k/quiz', id: formId });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || 'Quiz konnte nicht erstellt werden.' });
  }
}
