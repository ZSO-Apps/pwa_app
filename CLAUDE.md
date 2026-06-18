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
3. **Hierarchical permission levels**, each level includes all levels below
   it: `Admin` > `Offizier` > `Unteroffizier` > `Soldat` > `public`.
   - `public` = no auth needed, content must be offline-cachable via the PWA
     service worker.
   - All other levels require login; content is only available when the
     device can reach the local server (LAN).
   - Forms are never public. Public users must not see form Kacheln and must
     not be able to create or submit forms.
4. **Easy for other orgs to fork/contribute** — single language (JavaScript /
   Node ESM everywhere), readable code, file-based content and data (no
   database server to install). ZSO-specific overrides live in
   `content_zso_specific/`; public tenant branding assets live in
   `content_zso_specific_public/`, so a fork can replace local material
   without touching `content_generic/`.

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
/content_zso_specific/             org-specific overrides/additions
/content_zso_specific_public/
  logos/                            public tenant logos + fallback logo
/data/
  users.yaml                       user accounts (bcrypt + role), local runtime file
  forms/<form-id>/<wk-id>/         one JSON per submission, scoped to active WK
  forms/wk/_global/                WK records themselves (the wk form is scope=global)
/server/                           Node/Express app
  - merges the 2 content roots when serving a Kachel slug
  - renders markdown -> HTML server-side
  - serves /service-worker.js with a precache manifest of public assets
    including the logo files that currently exist
  - serves /logos/* from content_zso_specific_public/logos
  - serves protected Kacheln behind session auth (role hierarchy)
  - serves /forms: GET schema, POST submission, GET results — all scoped to active WK
  - active-WK middleware: cookie wkId, auto-pick nearest to today
/client/                           frontend assets, manifest.json, hand-written SW
```

A Kachel references a **slug** under `content:`. The server merges both content
roots that contain a folder with that slug: `content_generic/` first, then
`content_zso_specific/` (later wins on name collision, so a ZSO-specific file
overrides the generic one of the same name). Access is decided **only** by the
Kachel's `access:` in `layout.yaml`, never by which root a file lives in — the
same two roots serve public and protected Kacheln alike.

Forms are `.json` files dropped anywhere in a content folder. Each shows up as
two listing entries: 📝 submit (uses `submitLabel` + `submitAccess`) and 📊
results (uses `resultsLabel` + `resultsAccess`). Position in the UI is derived
from where the JSON sits in the content tree — there is no `submitKachel`
field anymore.

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
Admin > Offizier > Unteroffizier > Soldat > public
```

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
| `wk-organisation` | WK Organisation    | Unteroffizier | `wk_organisation` | hosts `essensbestellung.json`, `beurteilung*.json` |
| `wk-infos`        | WK Infos           | Soldat     | `wk_infos`        | `wkScoped` — shows the active WK's subfolder          |
| `wk-infos-kader`  | WK Infos Kader     | Unteroffizier | `wk_infos_kader` | `wkScoped` — Kader-only per-WK content              |
| `quiz`            | Quiz               | Soldat     | `quiz`            | hosts `quiz-leitungsbau.json` and future quizzes     |
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
  `wkId` cookie; `POST /wk/select` switches it.
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

### Branding and logos

- Tenant-specific public branding lives under
  `content_zso_specific_public/logos/`.
- The tracked fallback logo is `zivilschutz_logo.jpg`. It may be committed and
  is used wherever no tenant-specific logo exists.
- The local organization logos are intentionally ignored by Git:
  `org_logo_wide.png`, `org_logo_wide_transparent.png`,
  `org_logo_square.png`, `org_logo_square_transparent.png`.
- Logo resolution is centralized in `server/branding.js`.
  - Header order: wide transparent → wide → square transparent → square →
    fallback.
  - Print order: wide → square → fallback.
  - Favicon order: square → fallback.
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
- `users.yaml`: single file containing accounts + assigned role; local
  runtime file ignored by Git. It can be managed through the Admin UI or by
  direct file edits when necessary.

## Deployment Story

- Single Node process, runnable with `npm start`; default port is `8080`
  and can be overridden with `PORT=`.
- `Dockerfile` and `docker-compose.yml` exist. The current compose file
  builds the app, exposes `8080`, mounts `./data:/app/data`, and contains
  Traefik labels using `APP_DOMAIN` from `.env` / `.env.example`.
- Tenant content/logos are currently copied into the image at build time. If a
  deployment should update them without rebuilding, add volumes for
  `content_zso_specific/` and/or `content_zso_specific_public/logos/`.
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
  `Admin > Offizier > Unteroffizier > Soldat > public`. The `Soldat` role is
  intentional and is not renamed to `ZSO User`.

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
- Per-WK roster / Appell. The old YAML model with `kader`, `mannschaft`
  and an Appell sub-tree is gone for now. If reintroduced, it should
  layer on top of the current WK submission, not replace it.
