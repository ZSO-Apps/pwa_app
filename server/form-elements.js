// Shared knowledge about form element types so forms.js and the templates
// agree on what counts as a real (stored) field vs. a display-only element.
//
// A form's `fields[]` array may contain two kinds of entries:
//   - input elements  → have a `name`, produce a stored value, get a results
//                        column (text, number, date, time, email, textarea,
//                        radio, select, checkbox)
//   - display elements → structural / decorative, no stored value, no results
//                        column (heading, paragraph, image, signature)
//
// Any element may carry `printOnly: true`, meaning it is hidden while filling
// the form and only appears in the submission detail view / printout (e.g. a
// hand-filled checklist for staff).

const DISPLAY_TYPES = new Set(['heading', 'paragraph', 'image', 'signature']);

export function isDisplay(el) {
  return DISPLAY_TYPES.has(el?.type);
}

export function isInput(el) {
  return !isDisplay(el);
}

// A field whose value is actually validated, stored and shown in results.
export function isStored(el) {
  return isInput(el) && !el?.printOnly && !!el?.name;
}

// Elements shown while filling out the form (printOnly ones are hidden here).
export function visibleInForm(el) {
  return !el?.printOnly;
}
