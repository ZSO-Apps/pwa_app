# Plan: Versioned Forms & Quizzes

> Architecture change: allow editing a **form/quiz definition** (not just a single
> entry). Editing creates a **new version** with a new id; submissions are stored
> per version so that within a WK you can see which entries belong to which
> version. Status: **planned, not yet implemented.**

## Decisions (locked with the user)

1. **Storage layout:** Base / WK / version, nested — `data/forms/<family>/<wkId>/<versionId>/*.json`.
2. **Scope of versioning:** Everything **except `wk`** (includes `arbeitsplatz`, `transport-bestellung`, `essensbestellung`, `beurteilung`, builder forms, quizzes).
3. **Active version:** **Pinned-on-create** — each WK's active version is explicit state; creating a version pins it for the *current* WK only; other WKs keep what they had.
4. **Definition storage / listing:** Hidden versions folder, **single tile** per family.
5. **Roles:** Revise (create version) **and** pin/switch active version = **Unteroffizier+** (same as the form/quiz builder today).
6. **arbeitsplatz results:** **Aggregate across versions** (arbeitsplätze are reference data reused all WK long and feed location dropdowns). All other forms/quizzes stay strictly per-version.

## Core model

**Version identity**
- `family` = stable base id (`essensbestellung`, `arbeitsplatz`, `beurteilung`, quizzes, builder forms). Everything except `wk` is a family.
- `versionId`: the base version's id **is** the family id; new versions are `<family>_YYYYMMDD_HHMM_<n>` (`<n>` disambiguates same-minute edits).
- New-version JSONs carry a `version` block: `{ family, createdAt, createdBy }`. The base version has none — inferred (`versionId === id`).

**On-disk layout**
```
data/forms/<family>/<wkId>/_active.json          { versionId, pinnedBy, pinnedAt }
data/forms/<family>/<wkId>/<versionId>/*.json    submissions of that version
data/forms/<family>/_standard/<versionId>/*.json standardField (arbeitsplatz)
data/forms/wk/_global/*.json                     unchanged (wk not versioned)
```
- **Definitions:** new versions written to `content_zso_specific/<slug>/<family>.versions/<versionId>.json` (a hidden technical folder, like `.content`). Base stays where it is (generic or zso).

**Resolution rules**
- `activeVersionId(family, wkId)`: `_active.json` if present & valid, else base (family).
- Creating a version pins **only the current WK** to it. Creating a **new WK** auto-writes `_active.json` for every family pinning the newest version at that moment. Legacy/unpinned WK ⇒ base.
- Numbering `_meta.nr` is per **(family, WK)** across all version subfolders → `essensbestellung_3` stays unique in a WK; display label keeps using the family id.

**Lazy migration** (idempotent, in-place, like `backfillNrs`): first read/write of `<family>/<scope>` that still has flat `*.json` moves them (+ sibling `<id>.*` assets) into `<scope>/<family>/`; `_active.json` and scope dirs are never moved. `data/forms` is gitignored runtime data, so no repo churn.

## Two read paths
- **Per-version** (`readVersionSubmissions(family, scope, versionId)`): results display, submission detail/edit — each submission interpreted by *its own* version's schema.
- **Cross-version aggregate** (`readAllVersionSubmissions(family, scope)`, tags each row with `_meta.versionId`): the Transport dispo (open Bestellungen from essensbestellung + transport-bestellung), the arbeitsplatz **location datalist**, arbeitsplatz **overview**, and map-snapshot resolution. `dispatched.json` refs stay `<family>:<submissionId>`.

## File-by-file work

**`server/content.js`** — `scanForms()` skips `.versions` folders in the tile/asset walk (extend `isHiddenContentDirName`), then a second pass loads `.versions/*.json` into a version registry; family descriptor gains `_versions[]` (sorted, base first). `listKachelDir` shows **one** 📝+📊 tile per family.

**`server/layout.js`** — `getForm(id)` resolves family *or* version id; add `getFormVersion`, `getFormVersions(family)`; `loadLayout` holds both registries.

**`server/forms.js`** (largest change) — new helpers: `activeVersionId`, `pinVersion`, `pinNewWkToNewest`, `versionSubmissionDir`, `ensureMigrated`, `readVersionSubmissions`, `readAllVersionSubmissions`, `versionsWithResults`, `familyWkMaxNr`; refactor `backfillNrs` to (family, WK) scope. Rework:
- `renderForm`/`submitForm`: submit form action targets the resolved `/forms/<versionId>` (avoids a pin race between GET and POST); store in the version subfolder.
- `renderResults`: `?v=` picks the view version, default = **newest version with results** (fallback pinned/base); render that version's columns. Add revise button, **pin `<select>`** (POST, online-only), **view `<select>`** (GET), and the warning **"Achtung: Mehr als eine Version in diesem WK aktiv!"** when `versionsWithResults.length > 1`. arbeitsplatz → aggregate mode instead.
- `renderSubmission`/`renderSubmissionEdit`/`submitSubmissionEdit`/`serveSubmissionMap`: locate a submission across all version subfolders (+ `_standard`); edits write back into the same version.
- Revise: `GET/POST /forms/:family/revise` (Unteroffizier+) reuses the builder prefilled, writes the new version JSON, pins current WK, `loadLayout()`, redirect to results.
- arbeitsplatz: `arbeitsplatzNames`, `findArbeitsplatzSnapshot`, `createMinimalArbeitsplatz` (writes into the WK's pinned version), overview → aggregate.

**`server/index.js`** — routes for `revise` (GET/POST), `pin` (POST, online-only), `?v=` on results; `:id` handlers accept family or version id.

**`server/transport.js`** — `openBestellungen` iterates families with `transport` config on *any* version, aggregates via `readAllVersionSubmissions`, maps each submission by its own version def; `resolveBestellungRef` searches all versions.

**`server/content-admin.js`** — a "revise" mode for `normalizeFormDefinition`/`saveFormDefinition` that keeps the family id, assigns a versionId, writes into `<family>.versions/`; guard: block **renaming** a form family that has versions (id is the family key). Image fields land in `<versionId>.content/`.

**Templates + `client/app.js`/`styles.css`** — results page dropdowns/button/warning (view = GET nav, pin = online-only POST); builder "überarbeiten" mode; submission detail shows its version. Auto-refresh already pauses on focused inputs.

**`server/sw.js`** — no functional change (`.versions` are `.json`, already excluded; `/forms` stays network-first). Verify only.

**`CLAUDE.md`** — document the versioning model.

## Files to read before touching (unknowns)
The **quiz builder** (client + template — quizzes carry `correct` fields the form builder's `normalizeFormDefinition` doesn't handle, so revise must route to the right builder), `renderResultsPage` / `renderFormBuilderPage` signatures, and the builder client JS.

## Suggested phasing (each independently verifiable)
1. **Model & storage** — ✅ **done.** registries, resolution, paths, lazy migration, numbering, pin + auto-pin. Behavior identical when a family has only its base version (regression safety).
   - `server/content.js`: `.versions` folders are hidden (skipped in tile/asset/scan walks) and loaded into a versions registry; `scanForms()` returns `{ forms, versions }`, each family base def carries `_versions[]` (base first).
   - `server/layout.js`: `getForm(id)` resolves family *or* version id; added `getFormVersion`, `getFormVersions(family)`, `getFormVersionsMap()`.
   - `server/forms.js`: `familyOf`/`isVersioned`, `versionSubmissionDir`/`submissionDir`, `activeVersionId`, `pinVersion`, `pinNewWkToNewest` (called on WK create), `ensureMigrated` (lazy flat→`<scope>/<family>/` move incl. sibling assets), `familyScopeMaxNr`/`nextNr`, `readVersionSubmissions`, `readAllVersionSubmissions`; all readers/writers/map-snapshot paths rewired to the version subfolder. Submissions carry transient `_meta.versionId`.
   - `server/sw.js`: `readSubmissionSummaries` walks version subfolders so offline precache still lists detail URLs.
2. **Aggregate reads** — ✅ **done.** refactor transport + arbeitsplatz; verify single-version behavior unchanged.
   - `server/forms.js`: added `readAllVersionSubmissionsMerged(family, wkScope)` (cross-version, merges `_standard`); exported `familyOf`. `arbeitsplatzNames`, `findArbeitsplatzSnapshot` and the arbeitsplatz **overview** in `renderResults` now aggregate across versions; all other forms keep the active-version reader.
   - `server/transport.js`: `transportForms()` → `transportFamilies()` (transport config on base *or any* version); `openBestellungen`/`resolveBestellungRef` read via `readAllVersionSubmissionsMerged` and map each submission by its own version def (`submissionDef`); `ref`/`formId`/`nrLabel` use the stable family id.
3. **Revise flow** — ✅ **done.** builder revise mode (form + quiz), pin-on-create.
   - New `server/form-versions.js`: `versionsDir`/`versionAssetRoot`, `nextVersionId` (`<family>_YYYYMMDD_HHMM_<n>`), `writeVersionDefinition` (stamps the `version` block into `<family>.versions/`).
   - `server/content-admin.js`: **lossless** form revise — `normalizeReviseField(s)` preserves field names (Unicode-safe), passes `signature`/`printOnly` fields through verbatim, keeps display-field names, and carries over top-level config (`transport`, `standardField`, `modifyAllow`, `scope`); `renderFormReviseBuilder` + `writeFormRevision`. `renderFormBuilderPage` parametrized (`action`/`heading`/`submitLabel`/`hideId`).
   - `server/quiz-admin.js`: `renderQuizReviseBuilder` (prefill via `data-quiz-initial`), `writeQuizRevision`, existing-image passthrough. `renderNewQuiz` refactored onto shared `renderQuizBuilderPage`.
   - `server/forms.js`: `renderRevise`/`submitRevise` dispatch form vs quiz (`GET/POST /forms/:id/revise`, Unteroffizier+), pin the current WK on create, `loadLayout()`. `server/index.js` routes.
   - `client/app.js`: form builder gains a `map` type, read-only passthrough rows for `printOnly`/unsupported fields, and name/`_raw` preservation; quiz builder hydrates from `data-quiz-initial`.
   - Verified: transport-bestellung / essensbestellung / beurteilung / arbeitsplatz all revise byte-lossless (fields + config); pin makes new submissions land in the new version subfolder with continued per-(family,WK) numbering; the dispo aggregates open Bestellungen across versions. **Note:** the results view still defaults to the active/newest version (old submissions remain on disk, visible via the dispo aggregate) — the per-version view/pick UI is Phase 4.
4. **Results UI** — ✅ **done.** view/pin dropdowns, revise button, warning, per-version columns, versioned detail/edit.
   - `server/forms.js`: `renderResults` now picks a view version (`?v=` → newest-with-results → pinned/base), renders the table with that version's schema (`tableDef`), and passes a `version` context (options, active, `versionsWithResults`, `multiActive`, canRevise/canPin). Added `versionsWithResults`, `readVersionSubmissionsForView`, `versionOptionLabel`, `versionLabelFor`, and `pinVersionAction` (`POST /forms/:id/pin`, Unteroffizier+, validates the target version belongs to the family). `renderSubmission`/`renderSubmissionEdit`/`submitSubmissionEdit` resolve and use each submission's **own** version def (schema drift safe); detail shows a `Version:` line.
   - `server/templates/forms.js`: `renderVersionToolbar` (revise button + view/pin `<select>`s + warning); all `/forms/<…>` URLs and the `nr` label key on the stable **family** id via `familyId(def)`; `renderResultsPage` gained `tableDef`/`version`; submission detail shows `versionLabel`.
   - `server/index.js`: `POST /forms/:id/pin`. `client/styles.css`: `.version-toolbar`/`.version-warning`.
   - Verified: revise→submit puts new entries in the new version and the results view defaults to it; `?v=` switches to the base rows; the **"Achtung: Mehr als eine Version in diesem WK aktiv!"** warning appears once two versions hold results; pin (valid) switches the active version, invalid/cross-family pins are ignored; a **schema-drifted** version shows its extra column only in its own view/detail; `nr` labels stay `<family>_<n>`; base-only forms show just the revise button; arbeitsplatz stays aggregate (revise button only); Soldat is denied; no server errors.
5. **Polish** — ✅ **done.** online-only markers, guards, styles, docs.
   - `server/content-admin.js`: `pathHasVersionedFamily`/`guardVersionedFamily` block **renaming or deleting** a form family that already has revised versions (its id is the storage key), in both `renameContentEntry` and `deleteContentEntry`.
   - Online-only markers audited: revise link `data-online-only`, pin form `data-online-only-form` + button `data-online-only`; the view `<select>` is a plain GET nav (correctly unmarked).
   - `CLAUDE.md`: added the **"Versionierte Formulare & Quizze"** section (model, storage, pinning, two read paths, lossless revise, results UI, guards).
   - Verified: rename/delete of a versioned family is blocked with a clear message and leaves the file intact; a non-versioned form still renames/deletes normally; no server errors.

**Status: all five phases implemented and verified.**

## Known caveats to handle
- Renaming/deleting a versioned family (family id is the storage key — block rename, define delete semantics).
- Per-version schema drift in results columns (render each version by its own def).
