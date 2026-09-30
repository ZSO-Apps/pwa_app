# CLAUDE.md

Guidance for Claude (and other contributors) working on this project.

## Project Overview

Rewrite of the ZSO Brugg Region PWA (https://app.zso-bruggregion.ch/) as a
general-purpose, self-hostable "organization info app" that other
organizations can deploy too. Goals, in priority order:

1. **As simple as possible to deploy** — a single org should be able to run
   this on a Raspberry Pi / old PC / NAS on their local network, with minimal
   setup and no external dependencies.
2. **Works 100% offline on the local network**, including when the local
   WLAN itself has no internet uplink. Public content must work as a PWA
   even with zero connectivity at all (previously cached).
   - In the normal deployment the app *is* also reachable from the internet
     (hosted in the HQ LAN, exposed via a public domain like
     `app.zso-bruggregion.ch`), so devices outside the LAN can use it too.
     The offline-LAN guarantee above still holds: at the HQ everything must
     keep working even with the uplink down.
   - A few features inherently require that external reachability (a field
     device on cellular is not on the HQ LAN). **Live vehicle location
     tracking** (see Transport) is such a feature: it needs the server to be
     internet-reachable and degrades to "unavailable" on a pure offline-LAN
     deployment.
3. **Hierarchical permission levels**, each level includes all levels below
   it: `Admin` > `Offizier` > `Unteroffizier` > `Fahrer` > `Soldat` > `public`.
   - `public` = no auth needed, content must be offline-cachable via the PWA
     service worker.
   - All other levels require login; content is only available when the
     device can reach the local server (LAN).
   - Forms are never public. Public users must not see form Kacheln and must
     not be able to create or submit forms.
4. **Easy for other orgs to fork/contribute** — single language (JavaScript /
   Node ESM everywhere), readable code, file-based content and data (no
   database server to install). ZSO-specific overrides live in
   `content_zso_specific/`; per-organization public branding and content live
   in `ZSO/<Org>/`, surfaced at the fixed path `content_zso_specific_public`
   via a startup symlink (see "Organizations" below), so a fork can replace
   local material without touching `content_generic/`.

## Tech Stack Decisions

- **Language**: Node.js (plain JavaScript, ESM) — chosen over Go for
  contributor accessibility, and over TypeScript to keep the zero-build
  story. One language across server and client.
- **No Astro** — plain Node + Express serving both the static public
  content and the dynamic protected/forms routes from one process. Astro
  was rejected to avoid mixing a static-site-generator with a stateful
  server for no real benefit.
- **No SQLite / no database** — fully file-based storage (see below).
- **No build step** — server renders HTML via small string templates;
  client is vanilla JS + hand-written CSS.
- **Content authored as markdown + PDFs**, same authoring model as the
  existing site.

## Architecture

```
/layout.yaml                       Kacheln: slug + access level per Kachel
/content_generic/                  generic content shipped with the project
/ZSO/<Org>/                        per-org public branding (logos/) + public content
  logos/                            public tenant logos + fallback logo
/content_zso_specific_public       symlink → ZSO/<active Org> (generated at startup)
/content_zso_specific/             org-specific overrides/additions (highest priority)
/data/
  users.yaml                       user accounts (bcrypt + role), local runtime file
  forms/<form-id>/<wk-id>/         one JSON per submission, scoped to active WK
  forms/wk/_global/                WK records themselves (the wk form is scope=global)
/server/                           Node/Express app
  - setupOrg() symlinks content_zso_specific_public → ZSO/<Org> at startup
  - merges the 3 content roots when serving a Kachel slug
  - renders markdown -> HTML server-side
  - serves /service-worker.js with a precache manifest of public assets
    including the logo files that currently exist
  - serves /logos/* from content_zso_specific_public/logos
  - serves protected Kacheln behind session auth (role hierarchy)
  - serves /forms: GET schema, POST submission, GET results — all scoped to active WK
  - active-WK middleware: cookie wkId, auto-pick nearest to today
/client/                           frontend assets, manifest.json, hand-written SW
```

A Kachel references a **slug** under `content:`. The server merges the content
roots that contain a folder with that slug, in priority order (later wins on
name collision): `content_generic/` first, then `content_zso_specific_public/`
(the active org's public folder, symlink → `ZSO/<Org>`), then
`content_zso_specific/` (highest priority). Access is decided **only** by the
Kachel's `access:` in `layout.yaml`, never by which root a file lives in — the
same roots serve public and protected Kacheln alike.

Forms are `.json` files dropped anywhere in a content folder. Each shows up as
two listing entries: 📝 submit (uses `submitLabel` + `submitAccess`) and 📊
results (uses `resultsLabel` + `resultsAccess`). Position in the UI is derived
from where the JSON sits in the content tree — there is no `submitKachel`
field anymore.

Quiz definitions are the same kind of content JSON. `Quiz hinzufügen` lives in
the normal `+` menu of any editable Kachel/folder (`Unteroffizier` and above)
and stores the `.json` plus optional question images in the current
`content_zso_specific/<kachel-content>/<folder>/` location. Question images live
next to the quiz in `<Quiz-Titel>.content/`, which is hidden from listings but
served directly for forms and print views.

### Kacheln (tiles) and layout

- The frontend is organized as **Kacheln** (tiles). A Kachel means the
  complete menu entry — its content tree and any attached forms — not just
  the card on the start page.
- `layout.yaml` defines:
  - the list of Kacheln (title, slug, color)
  - the **access level required to see/open each Kachel**: one of
    `public`, `Soldat`, `Unteroffizier`, `Offizier`, `Admin`
  - this is the single source of truth for both navigation rendering and
    server-side access enforcement.
- A Kachel with `access: public`:
  - requires no login
  - merges `content_generic/` + `content_zso_specific/`
  - its UI route under `/k/...` and its files are included in the service
    worker precache, so they're available fully offline.
- A Kachel with `access: Soldat`/`Unteroffizier`/`Offizier`/`Admin`:
  - requires login with at least that role (hierarchy: `Admin` ⊇
    `Offizier` ⊇ `Unteroffizier` ⊇ `Soldat`)
  - merges the same two roots (`content_generic/` + `content_zso_specific/`)
  - successful online navigations are cached as the device's last online
    state, so a previously logged-in user can still see the last
    role-visible pages while offline.
- A Kachel with `wkScoped: true` (e.g. `WK Infos`, `WK Infos Kader`):
  - resolves its content to the active WK's subfolder, i.e. effective slug
    `<content>/<active-wk-id>` (see "Per-WK content Kacheln" below).
- Any Kachel folder may contain **subfolders**; they are listed with a folder
  icon and navigated recursively under `/k/<id>/...`.

### Role hierarchy

```
Admin > Offizier > Unteroffizier > Fahrer > Soldat > public
```

`Fahrer` sits between `Soldat` and `Unteroffizier`: a (typically shared,
generic) driver login that can read transport orders / the Transportzentrale
overview and mark trips abgefahren/angekommen, but cannot dispatch. The shared
base account `Fahrer` is added like `AdZS` (see Accounts below).

Each role inherits access to everything visible to roles below it. Access
checks are simple rank comparisons (e.g. `userRole >= requiredRole`), with
`public` always satisfied.

### Public zone (offline-first PWA)

- Markdown rendered to HTML on the server and cached by the service worker.
- The service worker precaches `/`, the public `/k/...` routes and their
  assets (markdown rendered as HTML, PDFs, images) walked across both content
  roots (`content_generic/`, `content_zso_specific/`) for `access: public`
  Kacheln, plus the static client assets.
- Form definitions (`.json`) and external `.url` shortcuts are excluded
  from the precache — they require either a live server or external
  network.
- Must work with **zero connectivity of any kind** once cached — e.g. a
  phone with no signal and not on the org WLAN.

### Protected Kacheln (LAN-only dynamic part)

- Requires reaching the local server over the org's WLAN — **not** the
  internet. This is the key trick: the backend lives on the local network,
  so login/protected Kacheln/forms work even when the WLAN has no internet
  uplink.
- Dynamic write actions cannot be used offline. They must be marked as
  online-only in the UI and be greyed out when the browser reports offline.
- Previously visited protected pages may be shown from cache as the last online
  state. Creating or submitting forms still requires reaching the local server.
- Auth: simple session cookies (or stateless signed cookies / JWT-ish, no
  server-side session store needed) + bcrypt password hashes + role in
  `users.yaml`.

### Current Kacheln

| ID                | Title              | Access     | Content slug      | Notes                                                |
|-------------------|--------------------|------------|-------------------|------------------------------------------------------|
| `lage`            | FU Lage            | public     | `Lage`            |                                                      |
| `telematik`       | FU Telematik       | public     | `Telematik`       |                                                      |
| `ntp`             | Notfall-Treffpunkt | public     | `NTP`             |                                                      |
| `unterstuetzung`  | Unterstützung      | public     | `Unterstützung`   |                                                      |
| `wk-organisation` | WK Organisation    | Unteroffizier | `wk_organisation` | hosts `essensbestellung.json`, `beurteilung*.json`, `transport-bestellung.json` |
| `wk-infos`        | WK Infos           | Soldat     | `wk_infos`        | `wkScoped` — shows the active WK's subfolder          |
| `wk-infos-kader`  | WK Infos Kader     | Unteroffizier | `wk_infos_kader` | `wkScoped` — Kader-only per-WK content              |
| `quiz`            | Quiz               | Soldat     | `quiz`            | hosts `quiz-leitungsbau.json` and future quizzes     |
| `appell`          | Appell             | Unteroffizier | — (route `/appell`) | per-WK attendance; own module, not content-folder based      |
| `transportzentrale` | Transportzentrale | Fahrer    | — (route `/transport`) | per-WK dispatch; own module. View Fahrer+, dispatch Uof+ |
| `admin`           | Admin              | Offizier   | `admin`           | hosts `wk.json` (Offizier+) and user management (Admin only) |

### Example `layout.yaml`

```yaml
kacheln:
  - id: lage
    title: "FU Lage"
    access: public
    content: Lage            # → content_generic/Lage (+ content_zso_specific/Lage)
    color: "#e8772e"

  - id: quiz
    title: "Quiz"
    access: Soldat           # merges both roots with slug "quiz"
    content: quiz            # → content_generic/quiz/ (+ content_zso_specific/quiz/)
    color: "#4a90a4"

  - id: wk-infos
    title: "WK Infos"
    access: Soldat
    content: wk_infos        # effective slug: wk_infos/<active-wk-id>
    wkScoped: true
    color: "#6c8ebf"
```

### Example form: `content_generic/quiz/quiz-grundlagen.json`

```json
{
  "id": "quiz-grundlagen",
  "title": "Wissens-Quiz Grundlagen",
  "submitLabel": "Wissens-Quiz",
  "resultsLabel": "Auswertung Wissens-Quiz",
  "submitAccess": "Soldat",
  "resultsAccess": "Unteroffizier",
  "fields": [
    { "name": "frage1", "type": "radio", "label": "…", "options": ["A","B","C"], "correct": "A" },
    { "name": "frage2", "type": "text",  "label": "…" }
  ]
}
```

Submissions land at `data/forms/quiz-grundlagen/<active-wk-id>/…json`. The
results view automatically filters to the active WK.

### WK context

- Every logged-in user works inside the context of one **active WK**. The
  second banner row below the top bar shows the active WK and offers a
  `<select>` to switch.
- WKs are themselves form submissions of the `wk` form
  (`content_generic/admin/wk.json`, `"scope": "global"`) and live at
  `data/forms/wk/_global/<id>.json`.
- WK archiving is tag-based, not folder-based: archived WK files stay
  in `data/forms/wk/_global/<id>.json` and receive
  `_meta.tags: ["archiviert"]` plus archive metadata. Active WK lists filter
  that tag out, `/forms/wk/archive` shows tagged WKs, and unarchiving removes
  the tag/metadata. Do not move WK files into an archive folder.
- Creating a WK auto-creates its per-WK content folders
  `content_zso_specific/wk_infos/<wk-id>/` and
  `content_zso_specific/wk_infos_kader/<wk-id>/` (see "Per-WK content
  Kacheln" below). Done in `ensureWkContentFolders` in `server/forms.js`.
- The server auto-picks the WK whose date range (start..ende) is closest to
  today (0 if today lies inside the range). The pick is persisted via the
  `wkId` cookie; `POST /wk/select` switches it. A valid `wkId` cookie is
  the source of truth during normal navigation. Stale `?wk=...` URLs are
  redirected to the cookie WK; `?wk=...` only initializes the cookie when no
  valid cookie exists.
- Every other form scopes its submissions to the active WK
  (`data/forms/<form-id>/<active-wk-id>/…`). Results views are auto-filtered
  to the active WK.
- If no WK has been created yet, submit/results endpoints return 409 with a
  hint to create one via Admin → WK erfassen. Reading regular content is
  unaffected.
- `data/forms/` is local runtime data and not committed.

### Per-WK content Kacheln (`wkScoped`)

- A Kachel marked `wkScoped: true` in `layout.yaml` shows content **for the
  active WK only**. Its effective content slug becomes
  `<content>/<active-wk-id>`, resolved by `effectiveKachel()` in
  `server/content.js` and threaded through the `/k/:id` routes in
  `server/index.js`.
- Two such Kacheln exist: `wk-infos` (`Soldat`) and `wk-infos-kader`
  (`Unteroffizier`). They hold per-WK material like Tagesbefehle and
  Arbeitsprogramme, typically as Markdown/PDF, optionally grouped in
  subfolders.
- The target folders are created automatically when a WK is erfasst (see WK
  context). Authors then drop files into
  `content_zso_specific/wk_infos/<wk-id>/` etc.
- Without an active WK these Kacheln return 409 with a hint to create/select a
  WK. With an active WK but an empty folder they render an empty listing
  (not a 404). Switching the active WK in the banner switches the shown
  content.

### Handkarten

- Handkarten are expected to be normal Markdown/PDF content.
- In the current repository snapshot they are **not** wired as a Kachel in
  `layout.yaml`, and there is no `content_generic/Handkarten` folder.
- If reintroduced, they should be a `public` Kachel with normal Markdown/PDF
  content so they are offline-capable like the other public content Kacheln.
- The app name remains "ZSO App".

### Organizations

- The app is multi-tenant. Each organization is a folder `ZSO/<Org>/` holding
  its public branding (`logos/`) and public content/Handkarten/documents.
- Pick the org at startup: `npm start -- <Org>`, `ORG=<Org> npm start`, or
  `node server/index.js <Org>`. Default is `Generic`.
- `setupOrg()` in `server/org.js` validates the name and points the fixed path
  `content_zso_specific_public` at `ZSO/<Org>` via a relative symlink (idempotent,
  re-pointed on each start). The symlink is generated and git-ignored; `ZSO/` is
  the tracked source of truth. A real directory at that path aborts startup with
  a migration hint. `ZSO/<Org>` is also wired in as the `zso_public` content root.
- Each org folder must contain its own default `logos/zivilschutz_logo.jpg`
  fallback (there is no cross-org fallback).

### Branding and logos

- Tenant-specific public branding lives under `ZSO/<Org>/logos/`, surfaced as
  `content_zso_specific_public/logos/` via the active-org symlink.
- The fallback logo is `zivilschutz_logo.jpg`, tracked per org folder and used
  wherever no tenant-specific logo exists.
- The local organization branding logos are intentionally ignored by Git
  (`ZSO/*/logos/org_logo_*.png`): `org_logo_wide.png`,
  `org_logo_wide_transparent.png`, `org_logo_square.png`,
  `org_logo_square_transparent.png`.
- Logo resolution is centralized in `server/branding.js`.
  - Header order: wide transparent → wide → square transparent → square →
    fallback.
  - Print order: wide → square → fallback.
  - Favicon order: square transparent → square → fallback.
- `/logos/*` serves these files publicly. `/favicon.ico` uses the branding
  resolver. The service worker adds existing logo URLs to its cache/fingerprint
  so the active branding survives offline after a successful online visit.
- Print templates render the logo in the same header row as the title. CSS
  positions it absolutely in print mode, with min/max dimensions, so it does
  not push metadata or form content onto a second page.

### Forms

- A form is a single JSON file dropped anywhere into a content folder
  (e.g. `content_generic/quiz/quiz-leitungsbau.json`). Position in the
  UI is derived from where the JSON lives — there is no `submitKachel`
  field anymore.
- Each form spec contains:
  - `id`, `title`, `submitLabel`, `resultsLabel`
  - `submitAccess` (default `Soldat`; `public` is treated as `Soldat`)
  - `resultsAccess`
  - `fields[]` — name/type/label/required/options/correct
  - optional `"compact": true` on a field renders the label and a smaller
    input inline (on one row) instead of stacked; honored both in the
    fill-out form and in the submission detail view
  - optional `"scope": "global"` for the `wk` form itself
- In every Kachel listing, each form appears as **two entries**: 📝 submit
  and 📊 results. Each entry is filtered by its respective access level.
- The generic server-side renderer turns the schema into an HTML form.
- Submissions are stored as **one JSON file per submission**:
  `data/forms/<form-id>/<wk-id>/<timestamp>-<uuid>.json`. For
  `"scope": "global"` forms (only `wk`), the directory is `_global`
  instead of a WK id. Append-only; safe from file-locking; inspectable
  via plain file tools (rsync, etc.).
- Results views automatically scope to the active WK (or to `_global`).

### Formular-Nummern

- Jede Submission erhält bei der Ablage eine fortlaufende Nummer `_meta.nr`,
  vergeben **pro Formular-Typ und pro Scope** (WK bzw. `_global`), beginnend
  bei 1. Anzeige als `<form-id>_<nr>` (z.B. `essensbestellung_3`) in der
  Auswertungs-Übersicht, der Detailansicht, beim Drucken und in der
  Transport-Dispo.
- Bestehende Submissions ohne `_meta.nr` werden beim ersten Lesen des
  Scopes nach `submittedAt` sortiert rückwirkend nummeriert und persistiert
  (Lazy-Backfill via `backfillNrs` in `server/forms.js`, danach idempotent;
  transiente Felder wie `_meta.submissionId`/`_meta.scope` werden vor dem
  Zurückschreiben entfernt). Neue Nummern = max(vorhandene) + 1.
- Label-Helper: `submissionNrLabel` in `server/forms.js`; UI-Styles
  `.nr-col`/`.sub-nr` in `client/styles.css`.

### Bearbeitbare Submissions (`modifyAllow`)

- Formular-JSON-Flag `"modifyAllow": true` schaltet einen Bearbeiten-Modus
  für Submissions frei (`GET/POST /forms/:id/results/:sid/edit`): der
  generische Formular-Renderer wird mit den bestehenden Werten vorbefüllt,
  Speichern validiert wie ein Submit, überschreibt die Submission-Datei und
  setzt `_meta.editedBy`/`editedAt`. `nr`, `submittedAt`, `submittedBy`,
  `wkId` und `tags` bleiben unverändert; danach Redirect auf die
  Detailseite. Bearbeiten dürfen Rollen ab `submitAccess`.
- Gate ist `isModifiable(def)` in `server/forms.js`: `modifyAllow` truthy
  **und** kein Quiz (`isQuizDef`) **und** nicht das WK-Formular.
- `Offizier`+ können `modifyAllow` direkt in der Auswertungs-Übersicht
  jedes Formulars umschalten (`POST /forms/:id/modify-allow`). Der Toggle
  schreibt das Flag in die Formular-JSON-Datei in place (2-Space-Pretty,
  egal in welchem Content-Root sie liegt) und hält den In-Memory-Cache
  synchron; dafür führt `scanForms` (`server/content.js`) den
  Definitionspfad als `def._file` mit. Für Quizze und das WK-Formular wird
  der Toggle nicht angeboten.
- Quiz und Essensbestellung bleiben bewusst **nicht** editierbar (Küche darf
  nicht auf altem Stand arbeiten); das Arbeitsplatz-Formular ist editierbar.
- Alle Schreibaktionen (Toggle, Bearbeiten) sind online-only
  (`data-online-only`).

### Standard-Scope (`standardField`)

- Formular-JSON-Feld `"standardField": "<checkbox-name>"`: ist diese
  Checkbox in einer Submission gesetzt, wird die Datei nicht im WK-Ordner,
  sondern in `data/forms/<form-id>/_standard/` abgelegt — für generische,
  WK-übergreifende Ressourcen (z.B. Standard-Arbeitsplätze).
- Auswertungen und `location`-Dropdowns solcher Formulare mischen den
  aktiven WK-Scope + `_standard` (Standard-Einträge sind in jedem WK
  sichtbar). Die Nummerierung läuft pro Scope weiter. Helpers in
  `server/forms.js`: `readSubmissionsMerged(formId, wkScope)` (jede
  Submission trägt `_meta.scope` als Herkunft; Standard-Zeilen erhalten in
  der Results-Tabelle ein Badge „Standard") und `readSubmissionAnyScope`
  (Detail-/Edit-Routen suchen erst im WK, dann in `_standard`).
- Standard-Submissions haben `_meta.wkId: null`.
- Beim Bearbeiten einer Submission verschiebt ein Umschalten der Checkbox
  die Datei per `fs.renameSync` zwischen WK-Ordner und `_standard`,
  inklusive generischer Sibling-Assets `<submission-id>.*` (z.B.
  `<id>.map.png`); im Ziel-Scope wird eine neue `nr` vergeben.
- `users.yaml`: single file containing accounts + assigned role; local
  runtime file ignored by Git. It can be managed through the Admin UI or by
  direct file edits when necessary.

## Deployment Story

- Single Node process, runnable with `npm start`; default port is `8080`
  and can be overridden with `PORT=`. Select the organization with
  `ORG=<Org>` (or `npm start -- <Org>`); default `Generic`.
- `Dockerfile` and `docker-compose.yml` exist. The current compose file
  builds the app, exposes `8080`, mounts `./data:/app/data`, passes `ORG`
  (default `Generic`, from `.env` / `.env.example`), and contains Traefik
  labels using `APP_DOMAIN`. The container entrypoint runs the org symlink
  bootstrap at start, so `ORG` alone selects the tenant.
- Tenant content/logos (the whole `ZSO/` tree) are copied into the image at
  build time. If a deployment should update them without rebuilding, add a
  volume for `ZSO/` (and/or `content_zso_specific/`).
- Discoverable on LAN via mDNS (`*.local`) or a printed QR code with the
  LAN IP, so devices can connect to the local server without internet.

## Conventions / Style

- Keep dependencies minimal — every new dependency raises the bar for
  "easy for other orgs to deploy/contribute."
- Prefer plain file I/O over abstractions; the data model should be
  legible by opening files directly (JSON/YAML), no opaque binary formats.
- Content authors (often non-developers) interact mainly with the
  `content_*/` roots and documented logo folder — keep them human-editable
  and documented.
- The public content editor is currently limited to Admin users and the
  four public Kacheln `lage`, `telematik`, `ntp`, and `unterstuetzung`.
  It writes new Markdown/PDF/image files only into `content_zso_specific/`
  under the currently viewed Kachel folder; generic content remains untouched.
- Avoid adding a build step for content if possible; markdown should be
  renderable directly by the running server.

## Decisions taken

These resolve the previously open questions and reflect the current code.

- **Server**: Node + Express (not Fastify, not Bun). Single ESM process,
  port `8080` (override with `PORT=`).
- **Frontend**: zero build step. Server renders HTML via small string
  templates in `server/templates/` (`index.js` only re-exports the split
  template modules); client is vanilla JS (`client/app.js`) + hand-written
  CSS (`client/styles.css`).
- **Auth**: stateless signed-cookie sessions, HMAC-SHA256 over
  `{username, role}` with a 32-byte secret from `SESSION_SECRET` or
  auto-generated and persisted to `data/.session-secret`. Passwords
  hashed with **bcryptjs** (pure JS, no native build) in local
  `data/users.yaml`. The repository tracks `data/users.example.yaml` with
  default demo accounts; the real runtime file is ignored by Git.
- **Service worker**: hand-written (no Workbox), served dynamically from
  `/service-worker.js`. Precaches `/`, public `/k/...` routes (recursive
  asset walk across the public content roots) and static client assets.
  Navigation requests are network-first and cache successful responses as
  the last online state. Static/Kachel assets remain cache-first.
- **Protected content**: LAN-only for fresh reads/writes. Previously visited
  protected pages can be shown from cache while offline, based on the last
  authenticated online access on that device.
- **Form placement**: forms attach themselves to a Kachel by being placed
  inside that Kachel's content folder in `content_generic/` or
  `content_zso_specific/`. No `submitKachel` / `resultsKachel` field
  anymore; the JSON file's location is the source of truth.
- **Auth UI**: there is no Login/Logout Kachel. The top bar shows a
  login icon in the top-right when anonymous and a logout icon (POST
  form) when signed in. The hamburger top-left opens the side nav with
  all role-visible Kacheln.
- **Accounts**: individual users and group accounts are both supported via
  `data/users.yaml`. The signed role remains valid until logout, even if
  `users.yaml` changes while the user is signed in.
- **Admin UI**: user management is implemented under the Admin Kachel.
  `content_generic/admin/users.json` exposes the overview/create entries;
  routes live in `server/user-admin.js`. Only `Admin` may create/edit/delete
  custom users. Protected base accounts (`Admin`, `Of`, `Uof`, `AdZS`)
  can have their password changed, but their name/role cannot be changed and
  they cannot be deleted. Form/layout management is not implemented yet.
- **Sync indicator**: timestamp `Offline-Inhalte aktualisiert: …` shown
  in small text under the top bar, written by the SW via `postMessage`
  on activate and persisted in `localStorage.lastSync`.
- **Kachel grid**: 3 columns on mobile, 4 on tablet, 6 on desktop.
  Kachel color comes from `layout.yaml`'s per-Kachel `color:` field
  (used as a top-border accent).
- **Content listings** show directories, `.md`, `.pdf`, `.url` entries,
  plus expanded form entries (📝 submit + 📊 results) for any `.json`
  form definition in the folder. Images live in the content folders but
  are referenced from inside markdown — they are not listed as standalone
  items.
- **Role naming** stays with the current model:
  `Admin > Offizier > Unteroffizier > Fahrer > Soldat > public`. The `Soldat`
  role is intentional and is not renamed to `ZSO User`. `Fahrer` is a driver
  role between `Soldat` and `Unteroffizier` (see Transport below).

## Still open

- Admin UI for managing forms/layout. User management already exists for the
  `Admin` role.
- mDNS / QR-code discovery on the LAN (not yet implemented).
- Docker deployment refinements: current Docker support exists, but compose
  only mounts `data/`. Decide per deployment whether tenant content/logos
  should also be mounted as volumes.
- ToDos: targets can be roles and/or individual users. ToDos need comment
  fields for addressing specific people inside roles. Completed ToDos remain
  visible, are struck through, and are sorted after open ToDos.
- (Done) Per-WK roster / Appell — implemented as the Appell module, see
  "Appell (Anwesenheit)" below. It layers on top of the active WK and does
  not touch the WK submission itself.

## Globale Suche

- Unten rechts ist eine rollenbasierte Suche eingebunden. Die API `GET /api/search?q=...` nutzt `visibleKacheln(role)` und durchsucht nur Kacheln, welche für die aktuelle Rolle sichtbar sind.
- Markdown-Dateien werden nach Dateiname und Inhalt durchsucht. PDF- und URL-Dateien werden über Dateiname bzw. Ziel-URL gefunden, ohne zusätzliche Datenbank oder Index-Datei.

## Auto-Refresh

- Die zentrale Browser-Logik liegt in `client/app.js` als `window.ZSOAutoRefresh`.
- Transportzentrale und Appell registrieren eigene Daten-Reloads und laden ihre JSON-APIs alle 15 Sekunden neu, statt die ganze Seite zu reloaden.
- Servergerenderte Übersichten wie Kachellisten, Home, Admin-User und Formular-Auswertungen reloaden die Seite alle 30 Sekunden.
- Auto-Refresh pausiert bei Offline-Status, verstecktem Tab, aktiven Eingabefeldern, offenen Dialogen/Modals, Druckzuständen und bei allen als geändert markierten Formularen/Tabellen. Dadurch gehen laufende Eingaben, Filter, Sortierungen und ausgewählte Zeilen nicht durch einen Refresh verloren.

## Quiz Builder

- Quizdefinitionen werden als normale Formular-JSON unter `content_zso_specific/quiz` erstellt. Optional hochgeladene Bilder liegen unter `content_zso_specific/quiz/.assets` und werden über `/k/quiz/.assets/...` ausgeliefert.
- Quiz hinzufügen ist für `Unteroffizier` und höher verfügbar. Ausfüllen bleibt `Soldat`, Auswertungen bleiben `Unteroffizier`.
- Single- und Multiple-Choice-Fragen werden erst in der Auswertung bewertet. Freitextfragen werden gespeichert, aber nicht automatisch bepunktet.

## Formular Builder

- Dropdown, Single Choice und Mehrfachauswahl werden im Builder mit einzelnen Optionszeilen gepflegt (`+ Antwort hinzufügen`), nicht mehr als Textarea mit einer Option pro Zeile.
- Formularfelder und Quiz-Fragen können im Builder `width: "half"`, `width: "third"` und `compact: true` setzen. Die Breiten-Checkboxen sind gegenseitig exklusiv.
- Formular- und Quiz-Builder unterstützen zusätzlich nicht gespeicherte Anzeigeelemente: Header, Paragraph und Bild. Bilddateien aus Formularen landen im Ordner `<formular-id>.content/`; Quiz-Bilder bleiben im Quiz-Asset-Ordner.
- Beim Speichern serialisiert der Client `options` als Array; der Server akzeptiert Arrays und zeilenbasierte Altwerte.

## Versionierte Formulare & Quizze

Formular-/Quiz-**Definitionen** sind überarbeitbar (alles ausser dem `wk`-Formular).
Eine Überarbeitung erzeugt eine **neue Version** mit eigener id; Submissions werden
**pro Version** abgelegt, damit innerhalb eines WK sichtbar bleibt, welche Einträge
zu welcher Version gehören. Plan + Phasen-Notizen: `docs/plan-versioned-forms.md`.

### Modell
- **Family** = stabile Basis-id (`essensbestellung`, `arbeitsplatz`, Quizze, Builder-
  Formulare). Die Basisversion hat `versionId === family` (kein `version`-Block);
  neue Versionen tragen `version: { family, createdAt, createdBy }` und die id
  `<family>_YYYYMMDD_HHMM_<n>`.
- **Ablage Submissions** (nested, gitignored):
  `data/forms/<family>/<scope>/<versionId>/*.json`; die Basisversion liegt im
  Unterordner `<family>/`. `data/forms/<family>/<scope>/_active.json`
  (`{ versionId, pinnedBy, pinnedAt }`) hält die aktive Version pro Scope. `wk`
  bleibt flach (`data/forms/wk/_global/*.json`).
- **Ablage Definitionen**: neue Versionen als
  `content_zso_specific/<slug>/<family>.versions/<versionId>.json` (verstecktes
  technisches Verzeichnis wie `.content`; von Listings/Suche/Form-Scan
  ausgeblendet, aber in die Versions-Registry geladen). Bilder einer Version
  liegen in `<versionId>.content/`.
- **Auflösung**: `activeVersionId(family, scope)` = `_active.json` falls gültig,
  sonst Basis. Nummerierung `_meta.nr` läuft **pro (family, scope)** über alle
  Versions-Unterordner. **Lazy-Migration** (`ensureMigrated`) verschiebt beim
  ersten Lesen/Schreiben flache Alt-Submissions idempotent nach
  `<scope>/<family>/` (inkl. Sibling-Assets).

### Aktive Version (pinned-on-create)
- Überarbeiten pinnt die neue Version **nur für den aktuellen WK**; andere WK
  behalten ihren Stand. Ein **neu erstellter WK** übernimmt automatisch die
  neueste Version jeder Family (`pinNewWkToNewest`). Ohne Pin ⇒ Basis.

### Zwei Lesepfade
- **Pro Version** (`readVersionSubmissions`): Auswertung, Detail/Bearbeiten —
  jede Submission wird durch die **eigene** Version interpretiert (Spalten-Drift
  ist erlaubt).
- **Versionsübergreifend** (`readAllVersionSubmissions[Merged]`, jede Zeile mit
  `_meta.versionId`): Transport-Dispo (offene Bestellungen über alle Versionen,
  je Submission per eigener Version-Def gemappt), Arbeitsplatz-`location`-Datalist
  und die **Arbeitsplatzübersicht** (aggregiert über Versionen, da Referenzdaten).

### Überarbeiten (Revise) — verlustfrei
- `GET/POST /forms/:family/revise` (**Unteroffizier+**) öffnet den passenden
  Builder (Formular vs. Quiz via `isQuizDef`) **vorbefüllt**, schreibt die neue
  Version, pinnt den aktuellen WK, `loadLayout()`, Redirect auf die Auswertung.
- **Verlustfrei**: Feldnamen bleiben erhalten (Unicode-ok), `signature`/
  `printOnly`-Felder werden read-only durchgereicht, Top-Level-Config
  (`transport`, `standardField`, `modifyAllow`, `scope`) wird übernommen. Der
  Formular-Builder kennt zusätzlich den Feldtyp `map`. Quiz-Feldnamen bleiben
  positionsbasiert (`frage<N>`), Optionen/`correct`/Bilder bleiben erhalten.

### Auswertungs-UI
- `renderResults` wählt eine **Ansichts-Version**: `?v=` → neueste Version mit
  Ergebnissen → gepinnte/Basis; die Tabelle rendert deren Spalten (`tableDef`).
- Versions-Toolbar: **„Überarbeiten"** (Uof+, online-only), **„Version anzeigen"**
  (`<select>`, GET-Navigation), **„Aktive Version"** (`<select>` + `POST
  /forms/:family/pin`, Uof+, online-only) und die Warnung **„Achtung: Mehr als
  eine Version in diesem WK aktiv!"** wenn mehrere Versionen im WK Ergebnisse
  haben. Basis-only-Formulare zeigen nur „Überarbeiten"; Arbeitsplatz zeigt nur
  „Überarbeiten" (Aggregat-Ansicht).
- Alle `/forms/...`-URLs und das `nr`-Label nutzen die **family**-id (Helper
  `familyId` in `server/templates/forms.js`), auch wenn eine Version-Def gerendert
  wird. Die Detailansicht zeigt bei Nicht-Basis-Versionen eine `Version:`-Zeile.

### Guards
- Eine Family mit Versionen kann über die Kachel-Verwaltung **nicht umbenannt
  oder gelöscht** werden (id ist der Speicherschlüssel; sonst würden Versionen +
  Submissions verwaisen) — `pathHasVersionedFamily`/`guardVersionedFamily` in
  `server/content-admin.js`.
- Shared helper in `server/form-versions.js` (`versionsDir`, `nextVersionId`,
  `writeVersionDefinition`).

## Appell (Anwesenheit)

Eigenständiges Modul zur täglichen Anwesenheitskontrolle pro WK. Bewusst
**nicht** über den generischen Formular-Mechanismus gelöst (mehrere hundert
Personen × Tage), sondern als eigene Route `/appell` (Kachel `appell`,
sichtbar ab `Unteroffizier`).

### Import (Excel → strukturierte Daten)
- Die Ausgangsdaten kommen als „Appellliste.xlsx" — ein Druck-Formular, in dem
  die Anwesenheits-„Felder" als **eingebettete Bilder** stecken (sichtbares
  graues Kästchen = an diesem Tag aufgeboten, vollständig transparentes Bild =
  nicht aufgeboten). `server/appell-import.js` entpackt die xlsx mit `fflate`,
  liest `sharedStrings`/`worksheet`/`drawing` und entscheidet pro Bild über die
  **mittlere Alpha-Deckung** (transparent ≈ 0 ⇒ nicht aufgeboten). Pro Person
  werden Name, Grad, Bereich, Funktion, JG, Beruf, Ort, Einrückort, Mobile/Email
  und die aufgebotenen Tage extrahiert.
- **Upload nur für `Offizier`+.** Nach dem Upload entsteht ein **Entwurf**
  (`roster.draft.json`), der mit Diff (neu / entfallen / geänderte Tage)
  geprüft und von Hand korrigiert werden kann, bevor er per „Übernehmen" zum
  aktiven `roster.json` wird.

### Mehrere Listen + versionierter Re-Import
- Ein WK kann **mehrere Listen** halten (z.B. `KVK`, `ZSO Baden`, `ZSO Brugg`),
  jede mit eigenem Tagesbereich. Beim Import wählt man „neue Liste" oder
  „bestehende aktualisieren".
- **Re-Import derselben Liste** ersetzt `roster.json` (neueste Version gewinnt),
  sichert die Vorgängerversion als `roster.<ts>.json` und erhöht `meta.version`
  — gedacht für Dienstverschiebungen (z.B. Freitag vor dem WK nochmals
  importieren). In-App erfasste **Tags und Status bleiben erhalten** (eigene
  Dateien, Schlüssel = Hash der Soz.-Vers.-Nr.).

### Datenmodell (file-based, pro WK)
```
data/appell/<wk-id>/lists/<list-id>/
  meta.json            Name, version, importedAt, days[]
  roster.json          aktive Version
  roster.draft.json    Entwurf bis „Übernehmen"
  roster.<ts>.json     Backup der Vorgängerversion
  tags.json            { pid: [tags] }   (Gruppeneinteilung, Uof+ pflegt)
  status/<pid>.json    { pid, days: { iso: { status, bemerkung, by, at } } }
```
- `pid` = erste 12 Hex von sha256(Soz.-Vers.-Nr.) — stabil über Importe,
  ohne AHV-Nummer im Dateipfad.
- **Status pro Person eine Datei** → keine Schreibkonflikte bei mehreren
  gleichzeitig erfassenden Uof. `data/appell/` ist Runtime-Daten (gitignored).

### Bedienung
- Logik in `server/appell.js`, Frontend in `client/appell.js` (+ CSS in
  `client/styles.css`). API: `GET /api/appell/lists`, `GET /api/appell/data`,
  `POST /api/appell/status`, `POST /api/appell/tags`.
- **Listen-Auswahl** oben: Default ist **„Alle Appelllisten"** (`list=__all`),
  eine kombinierte Ansicht über alle Listen des WK (Tage = sortierte Vereinigung,
  jede Person behält ihre `listId`/`listName`, damit Status-/Tag-Writes an die
  richtige Liste gehen). Einzelne Listen sind separat wählbar.
- **Filter** nach Bereich, Funktion, Grad, Liste (in der kombinierten Ansicht),
  Tag (Gruppe) und Name.
- **Drucken** (Button in der Übersicht): druckt die Matrix mit der **aktuell
  gewählten Liste und allen aktiven Filtern**. Erzwingt Querformat, blendet die
  Bedienelemente aus und setzt einen Print-Header (Liste, Filter, Stand). Da
  Browser Hintergrundfarben oft nicht drucken, werden die aufgebotenen Felder
  als umrandete Kästchen und der Status zusätzlich als Glyphe (✓/✗/K) gedruckt
  (`print-color-adjust: exact` für die Farben).
- **Übersicht** = Matrix Personen × Tage; der heutige Tag ist hervorgehoben und
  vergrössert. Klick auf ein Feld zyklisch **neutral → grün (anwesend) → rot
  (abwesend) → orange (krank) → neutral**. Nur aufgebotene Tage sind klickbar.
- **Tagesansicht** = grosse Zeilen für einen Tag (Default heute) zum schnellen
  Abhaken, mit Bemerkungsfeld.
- **Mobilnummer** platzsparend hinter einem 📱-Icon (Klick zeigt `tel:`-Link).
  Voller Kontakt + Tag-Verwaltung im Personen-Detail (Klick auf den Namen).
- **Status/Tags erfassen ab `Unteroffizier`.** Dynamische Schreibaktionen sind
  LAN-only und werden offline blockiert.
## Content Plus Menü

- Das `+`-Menü ist ab `Unteroffizier` auf allen Kacheln mit `content` verfügbar, nicht mehr auf eine fixe Kachel-Liste beschränkt.
- Inhalte werden in `content_zso_specific` geschrieben. Bei WK-spezifischen Kacheln wird der aktive WK-Unterordner verwendet.
- Das Menü erstellt Markdown-Dateien, generische Formular-JSONs, importiert Markdown/PDF/Bilder, verlinkt Webseiten und erstellt Ordner.
- Bilder zu Markdown-Dateien und Quizfragen werden in sibling asset folders mit Endung `.content` gespeichert, z.B. `Meine Datei.content/`. Diese Ordner sind technische Asset-Ordner und werden in Kachel-Übersichten, Suche und Form-Scan ausgeblendet.
- Markdown-Dateien können ab `Unteroffizier` direkt bearbeitet werden. Sichtbare Listing-Einträge aus allen Content-Roots (`content_generic`, aktive Organisation via `content_zso_specific_public`, `content_zso_specific`) können ab `Unteroffizier` umbenannt oder gelöscht werden, sofern die Rolle Zugriff auf die Kachel hat.
- Umbenennen/Löschen in Kachel-Listings liegt in einem kompakten Pfeil-Dropdown pro Eintrag, damit die mobile Ansicht nicht mit selten genutzten Aktionen überladen wird.
- Der Markdown-Editor verwendet lokal ausgeliefertes EasyMDE (`/vendor/easymde/*`) statt CDN. Spellchecker und FontAwesome-Autodownload sind deaktiviert, damit der Editor auch im lokalen/offlinefähigen Betrieb keine externen Assets nachlädt. Gespeichert wird weiterhin reines Markdown; Bilder laufen über die bestehende `Dateiname.content/`-Ablage.
- Erstellen, Importieren, Bearbeiten, Umbenennen, Löschen und Speichern sind Online-only. Die UI markiert diese Elemente mit `data-online-only` bzw. `data-online-only-form`, damit gecachte Offline-Seiten keine Schreibaktionen auslösen.

## Transport (Transportzentrale)

Durchgängiger Transport-Workflow: Bestellung → Disposition → Fahrauftrag →
Fahrer. Eigenständiges, file-basiertes Modul pro WK (wie Appell), **nicht** über
den generischen Formular-Mechanismus (Aufträge müssen editierbar sein, Zeitstrahl,
Status, Timestamps).

### Rolle `Fahrer`
- Neuer Rang zwischen `Soldat` und `Unteroffizier` in `ROLE_RANK`
  (`server/auth.js`). In der Admin-UI wählbar (`USER_ROLES` in
  `server/user-admin.js`); geteiltes Basiskonto `Fahrer` (wie `AdZS`) in
  `users.example.yaml`. Fahrer sehen Übersicht + Aufträge und melden
  abgefahren/angekommen, **disponieren aber nicht**.

### Bestellung
- `content_generic/wk_organisation/transport-bestellung.json` — normales
  generisches Formular (Uof+). Felder: Besteller (Name/Mobile), Fahrt
  (Datum/Zeit/Abfahrts-/Zielort/Anzahl Personen), Fahrt-Details (Einfache /
  Hin- und Rückfahrt / Besondere Fahrt), Anhänger-Details (Checkbox+Anzahl pro
  Typ als Wunsch), Beschreibung. Submissions wie üblich unter
  `data/forms/transport-bestellung/<wk-id>/`.

### Generische Transport-Anforderung (`transport`-Config)
- Jedes Formular kann per Top-Level-Config in der Dispo als offene
  Bestellung auftauchen:
  `"transport": { "always": true }` (jede Submission, so bei
  `transport-bestellung`) oder `"transport": { "field": "<checkbox-name>" }`
  (nur Submissions mit gesetzter Checkbox). Optionales
  `"map": { datum, zeit, abfahrtsort, zielort, anzahlPersonen, name,
  mobile, beschreibung → <feld-name> }` mappt Formularfelder auf die
  Auftrags-Vorbefüllung; nicht gemappte Felder bleiben leer.
- Die Essensbestellung hat die Checkbox „Transport benötigt"
  (`transportBenoetigt`) und `transport.field` darauf; `ort` mappt auf
  `zielort`, `datum`/`name`/`mobile`/`kommentar` entsprechend.
- Die Dispo scannt alle Formular-Definitionen mit `transport`-Config
  (`openBestellungen` in `server/transport.js` nutzt `getForms()` +
  `readSubmissionsMerged`). Jede offene Bestellung trägt `formId`,
  `formTitle`, `ref` (`<form-id>:<submission-id>`), `nrLabel`
  (`<form-id>_<nr>`) und die per `map` gemappten Auftragsfelder
  (`mapBestellung`); `fahrtTyp` wird generisch durchgereicht, damit der
  „Hin- und Rückfahrt"-Flow (ein oder zwei Aufträge) weiter funktioniert.

### Verknüpfung Bestellung ↔ Fahrauftrag
- `dispatched.json`-Keys sind `<form-id>:<submission-id>`; alte nackte Keys
  normalisiert `readDispatched` beim Lesen zu `transport-bestellung:<id>`.
- Fahraufträge tragen `bestellungIds: []` (Refs `<form-id>:<submission-id>`,
  mehrere Bestellungen pro Auftrag möglich); `migrateOrder` überführt
  Legacy-`bestellungId` beim Lesen.
- Verknüpfen: **Drag & Drop** einer offenen Bestellungskarte
  (`draggable`, dataTransfer = ref) auf einen Auftrags-Balken im
  Zeitstrahl oder eine Auftragskarte in der Liste, oder Dropdown
  „Bestellung verknüpfen" in der Auftrags-Detailansicht (dort auch wieder
  lösbar). API: `POST /api/transport/order/:id/link` / `/unlink` `{ ref }`
  (Uof+), serverseitig `linkOrderBestellung`/`unlinkOrderBestellung`
  (pflegen Order + `dispatched.json`; nach Unlink ohne verbleibende Orders
  wird die Bestellung wieder als offen gelistet). Nur mit `canDispatch`.
- `/api/transport/data` liefert pro Auftrag die aufgelösten
  Bestellungs-Infos (`o.bestellungen` via `resolveBestellungRef`; fehlende
  Submissions werden toleriert). Detailansicht und Einzelauftrag-Druck
  zeigen die Nummern der verknüpften Bestellungen, verlinkt auf
  `/forms/<form-id>/results/<submission-id>`.

### Standard-Fuhrpark
- `data/transport/_standard/fleet.json` hält WK-übergreifende
  Fahrzeuge/Anhänger; `readFleet` mischt Standard + WK-Fleet (WK gewinnt
  bei Namenskollision; gemergte Standard-Ressourcen tragen
  `standard: true`). `writeFleet` splittet den gemergten Fleet beim
  Speichern anhand des Flags zurück in die zwei Dateien — dadurch landen
  on-the-fly (per Tippen im Auftrag) angelegte Ressourcen immer im
  WK-Fleet, und Updates an Standard-Ressourcen (Name, trailerType,
  `unavailable`, delete) treffen die richtige Datei.
- Im Fuhrpark-Modal hat jede Ressource die Checkbox „Standard-Auswahl";
  `POST /api/transport/fleet` (`action: 'update'`) akzeptiert
  `standard: true/false` und verschiebt die Ressource zwischen WK- und
  Standard-Fleet. `unavailable`-Sperren bleiben pro Ressource.

### Modul (`server/transport.js`, `client/transport.js`)
- Kachel `transportzentrale`, Route `/transport`, Zugriff `Fahrer`+.
- Datenmodell (`data/transport/<wk-id>/`, gitignored):
  `fleet.json` (`{vehicles, trailers}`), `orders/<order-id>.json` (editierbarer
  Fahrauftrag), `dispatched.json`
  (`{"<form-id>:<submission-id>": [orderId,...]}`), plus WK-übergreifend
  `data/transport/_standard/fleet.json` (Standard-Fuhrpark).
- **Fuhrpark pro WK, on-the-fly**: tippt die Dispo beim Auftrag „PTF1", wird das
  Fahrzeug/der Anhänger automatisch angelegt (ganze WK-Dauer). Lightweight
  Fuhrpark-Verwaltung (Modal) für Uof+; Ressourcen lassen sich an einzelnen
  Daten als „nicht verfügbar" sperren.
- **Dispo** (Uof+): offene Bestellungen → Fahraufträge. Bei „Hin- und Rückfahrt"
  wahlweise **ein oder zwei** Aufträge (pro Fall entscheidbar). Zuteilung von
  Fahrzeug + konkreten benannten Anhängern, je mit Flag `bleibtAmZielort` +
  Standort.
- **Anhänger** erscheinen als eigene Zeitstrahl-Zeilen; `bleibtAmZielort` zeigt
  „steht auswärts an <Ort>" (Übersicht „Anhänger auswärts"). Fail-safe:
  Button **„freigeben"** (Uof+) setzt den Anhänger zurück.
- **Fahrer** (`Fahrer`+) tragen im Auftrag **Name + Mobile** ein (in
  `localStorage` gecacht wie bei anderen Formularen, zusätzlich auf dem Auftrag
  gespeichert für Dispo/Ausdruck) und melden `abgefahren`/`angekommen` mit
  Kommentar. Der Button stempelt „jetzt", das Zeitfeld erlaubt manuelle
  Eingabe/Korrektur. Im Zeitstrahl bleibt der **blaue Plan-Balken immer sichtbar**;
  die Ist-Situation ist ein dünner Strich darunter. **Fail-safe** (`GRACE=60`
  min in `computeBar`): ein laufender Auftrag ohne „angekommen" wird auf
  `plannedEnd + GRACE` begrenzt und danach als „überfällig" markiert — kein
  24h-Balken bei vergessener Zeitangabe.
- **Übersicht**: Zeitstrahl (15-min-Slots, dynamischer Tagesbereich) Ressource ×
  Zeit, plus „Aufträge"-Listenansicht für Fahrer. Überlappende Aufträge werden
  wasserfallartig in Lanes gestapelt. **Fahrzeug-Filter** wird in `localStorage`
  gemerkt (geteiltes Fahrer-Login).
- **Drucken**: Einzelauftrag (Button im Auftrag) druckt eine saubere Zusammen-
  fassung **mit WK-Kontext**; „Drucken" in der Übersicht skaliert den Zeitstrahl
  auf eine Querformat-Seite (mit WK-Kopf), da der Zeitstrahl sonst scrollbar/zu
  breit ist.
- API: `GET /api/transport/data?date=`, `POST /api/transport/fleet`,
  `POST /api/transport/order` (+ `/:id`, `/:id/delete`, `/:id/status`),
  `POST /api/transport/trailer/release`. Schreiben Uof+ (Status Fahrer+).
- **Offline**: `/transport`, `/forms/...` und `GET /api/transport/...` werden
  network-first geholt und als letzter Online-Stand gecacht (`server/sw.js`),
  damit Fahrer+ Inhalte offline lesen können. Erstellen/Bearbeiten bleibt
  LAN-only und wird offline blockiert.

## Arbeitsplätze

- Arbeitsplätze laufen über den **generischen Formular-Mechanismus**:
  `content_generic/wk_organisation/arbeitsplatz.json` mit
  `submitAccess`/`resultsAccess: Unteroffizier`, `"modifyAllow": true` und
  `"standardField": "standard"`. Felder: Bezeichnung (`name`),
  Kontaktperson, Kontaktperson Mobile, Adresse, Koordinaten,
  Kartenausschnitt (`map`-Feld), Checkbox „Standard-Auswahl".
- Die **Arbeitsplatzübersicht** ist die Results-Ansicht dieses Formulars in
  der WK-Organisation (zeigt WK-eigene + Standard-Arbeitsplätze, alles ab
  `Unteroffizier`).
- **Feldtyp `location`**: Text-Input mit `<datalist>` aller
  Arbeitsplatz-Bezeichnungen (aktiver WK + `_standard`); Freitext bleibt
  erlaubt. Ein Freitext-Wert, der keinem bestehenden Arbeitsplatz
  entspricht (case-insensitiv), legt beim Submit **und** beim Edit
  automatisch einen minimalen Arbeitsplatz (nur Bezeichnung) im WK-Scope
  an (in `server/forms.js`, guard `formId !== 'arbeitsplatz'`). `ort`
  (Essensbestellung) sowie `abfahrtsort`/`zielort` (Transport-Bestellung)
  sind `location`-Felder. `location` und `map` sind auch im
  Formular-Builder wählbar (`server/content-admin.js`, `client/app.js`).
- **Feldtyp `map`** (online-only, offline ausgegraut mit Hinweis): Widget
  in `client/map-field.js`, nur eingebunden wenn das Formular ein
  map-Feld hat. Leaflet lokal gebündelt unter `/vendor/leaflet`
  (npm-Paket, kein CDN) mit Swisstopo-WMTS-Tiles (`wmts.geo.admin.ch`,
  `ch.swisstopo.pixelkarte-farbe`, Web-Mercator/3857, Zoom 7–18). Pin
  setzen wahlweise per Geocoding der Adresse (api3.geo.admin.ch
  SearchServer), per Koordinaten-Eingabe (WGS84 oder LV95/LV03 →
  WGS84-Näherung im Client) oder per Klick/Ziehen auf der Karte; „Pin
  entfernen" leert den Wert. Gespeichert wird `{ lat, lon, zoom }` als
  JSON-String im Submission-Wert (hidden input). In Auswertungs-Spalten
  wird das map-Feld ausgeblendet, im Detail nie als Roh-JSON gezeigt.
- **Karten-Snapshot**: `generateSnapshot` in `server/map-snapshot.js` —
  beim Speichern (Submit oder Edit, fire-and-forget mit Fehler-Log) holt
  der Server die betroffenen Tiles (~768×512 px, Pin zentriert; Grösse
  über `OUT_W`/`OUT_H` einstellbar), stitcht sie und zeichnet den Pin —
  pure JS über `jpeg-js` (Tile-Decode) + `pngjs` (Encode), keine nativen
  Dependencies. Tile-Fetch über `node:https` (kein global `fetch`, läuft
  auch auf Node 16). Ablage als `<submission-id>.map.png` neben der
  Submission-Datei, ausgeliefert über
  `GET /forms/:id/results/:sid/map.png` (Zugriff = `resultsAccess`, sucht
  beide Scopes). Detailansicht und Druck binden **nur dieses Bild** ein;
  ohne Pin/Snapshot wird nichts angezeigt oder gedruckt. Snapshot-Fehler
  (kein Uplink) brechen das Speichern nicht ab.
- **Auflösung Ort → Snapshot**: `findArbeitsplatzSnapshot(wkId, name)` in
  `server/forms.js` (case-insensitiver Namensvergleich, WK + `_standard`,
  nur mit existierendem PNG). Der **Druck eines Fahrauftrags** nutzt das
  per `mapUrl` am Order in `/api/transport/data` (Zielort, sonst
  Abfahrtsort); die Detail-/Druckansicht von Formularen mit
  `location`-Feldern (z.B. Transport-Bestellung) zeigt den Snapshot des
  ersten aufgelösten Ort-Werts. Kein Snapshot → kein Kartenblock.
- Service Worker: `/vendor/*` wird wie `/client/*` behandelt; die
  externen Karten-Hosts (wmts/api3.geo.admin.ch) werden nie gecacht.
