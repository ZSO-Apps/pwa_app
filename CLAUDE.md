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
   it: `admin` > `Offizier` > `Unteroffizier` > `Soldat` > `public`.
   - `public` = no auth needed, content must be offline-cachable via the PWA
     service worker.
   - All other levels require login; content is only available when the
     device can reach the local server (LAN).
   - Forms are never public. Public users must not see form Kacheln and must
     not be able to create or submit forms.
4. **Easy for other orgs to fork/contribute** — single language (TypeScript
   everywhere), readable code, file-based content and data (no database
   server to install).
5. The old project is in the folder old_app.

## Tech Stack Decisions

- **Language**: TypeScript / Node (or Bun) — chosen over Go for
  contributor accessibility. One language across server and client.
- **No Astro** — plain Node server (Express or Fastify) serving both the
  static public content and the dynamic protected/forms routes from one
  process. Astro was considered but rejected to avoid mixing a
  static-site-generator with a stateful server for no real benefit.
- **No SQLite / no database** — fully file-based storage (see below).
- **PDFs and content authored as markdown + frontmatter**, same authoring
  model as the existing site.

## Architecture

```
/layout.yaml           defines Kacheln (tiles): structure + access level per Kachel
/content/              public markdown + PDFs (git-managed, no login)
/protected/            markdown + PDFs for Offizier/Unteroffizier/Soldat levels
/forms/<form-id>.json  form definitions (schema, access levels, target Kachel)
/data/
  users.yaml           user accounts (bcrypt hashes + role), hand/admin-edited
  wk/<wk-id>.yaml      one file per WK with number, name, roster and Appell
  forms/<form-id>/
    <timestamp>-<uuid>.json   one file per form submission (append-only)
/server/               Node/Express app
  - renders markdown -> HTML server-side
  - reads layout.yaml to build navigation + enforce per-Kachel access checks
  - serves /content as static + provides SW precache manifest (public Kacheln only)
  - serves protected Kacheln behind session auth, checking role hierarchy
  - serves /forms: GET schema (render generic form, check submit access),
    POST submission (check submit access), GET results (check read access)
/client/ (or /public/) frontend assets, manifest.json, service worker
```

### Kacheln (tiles) and layout

- The frontend is organized as **Kacheln** (tiles). In this project, a Kachel
  means the complete menu entry including its UI, content and attached function,
  not only the visual card on the start page (e.g. "FU Lage",
  "NTP Allgemeines", a quiz form, etc.).
- A single `layout.yaml` (or `.json`) at the project root defines:
  - the list/structure of Kacheln (title, icon, target content or form)
  - the **access level required to see/open each Kachel**, one of
    `public`, `Soldat`, `Unteroffizier`, `Offizier`, `admin`
  - this is the single source of truth for both navigation rendering and
    server-side access enforcement — the server must check this file
    before serving any content tied to a Kachel, not just hide it in the UI
- A Kachel with access level `public`:
  - requires no login
  - its UI route under `/k/...` and its content (markdown/PDFs/images) are included in the service worker
    precache list, so it's available fully offline
- A Kachel with access level `Soldat`/`Unteroffizier`/`Offizier`/`admin`:
  - requires login with at least that role (hierarchy: `admin` ⊇
    `Offizier` ⊇ `Unteroffizier` ⊇ `Soldat`)
  - content lives under `/protected/` and is served dynamically
  - successful online navigations are cached as the device's last online state,
    so a previously logged-in user can still see the last role-visible pages
    while offline

### Role hierarchy

```
admin > Offizier > Unteroffizier > Soldat > public
```

Each role inherits access to everything visible to roles below it. Access
checks are simple rank comparisons (e.g. `userRole >= requiredRole`), with
`public` always satisfied.

### Public zone (offline-first PWA)

- Markdown rendered to HTML on the server and cached by the service worker.
- The service worker precaches `/`, the public `/k/...` routes, the entire
  `/content` tree, PDFs, images and static client assets.
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

### Example `layout.yaml`

```yaml
kacheln:
  - id: fu-lage
    title: "FU Lage"
    access: public
    content: content/Lage

  - id: ntp-allgemeines
    title: "NTP Allgemeines"
    access: public
    content: content/NTP

  - id: einsatz-details
    title: "Einsatzdetails"
    access: Soldat
    content: protected/Einsatz

  - id: quiz
    title: "Wissens-Quiz"
    access: Soldat        # who can see/open this Kachel at all
    form: quiz-grundlagen # references /forms/quiz-grundlagen.json

  - id: quiz-results
    title: "Quiz-Auswertung"
    access: Unteroffizier
    formResults: quiz-grundlagen
```

### Example `/forms/quiz-grundlagen.json`

```json
{
  "id": "quiz-grundlagen",
  "title": "Wissens-Quiz Grundlagen",
  "kachel": "quiz",
  "submitAccess": "Soldat",
  "resultsAccess": "Unteroffizier",
  "fields": [
    { "name": "frage1", "type": "radio", "label": "...", "options": ["A", "B", "C"] },
    { "name": "frage2", "type": "text", "label": "..." }
  ]
}
```

### WK files and Appell

- Each WK is represented by one YAML file under `data/wk/<wk-id>.yaml`.
  This keeps WK data inspectable and gives later forms a stable `wkId`
  reference.
- Every WK has at least an `id`, `nummer`, `name`, optional date range,
  `kader` and `mannschaft`.
- "Eingetragen" means the user or group account is present in the WK file in
  either `kader` or `mannschaft`. It is not inferred from login alone and is
  not a self-check-in unless an admin/officer later adds that workflow.
- The WK Information module renders a table of existing WK files. The WK
  name/title is the read-only detail link. Reading WK entries requires
  `Unteroffizier` or higher.
- Creating a WK from the GUI requires `Offizier` or higher. The creation mask
  captures Nummer, Name, Hinweis, Eckdaten, Tagesablauf, persönliche
  Ausrüstung and Kontakt.
- An Appell can be created once Kader and Mannschaft are entered. The Appell is
  stored in the same WK file and records per-person status plus comments.
- Real WK files are runtime data and are ignored by Git. The repository tracks
  only `data/wk/*.example.yaml` templates.

### Handkarten

- Handkarten are normal Markdown/PDF content.
- They are public and offline-capable like the other public content Kacheln.
- The app name remains "ZSO App".

### Forms

- Each form is defined by a single JSON file: `/forms/<form-id>.json`,
  specifying:
  - the field schema (fields, types, labels, validation)
  - **which Kachel it should appear in** for submission (e.g. a "Quiz"
    Kachel)
  - **`submitAccess`**: minimum role required to submit (e.g. `Soldat` —
    Soldat and above can submit)
  - **`resultsAccess`**: minimum role required to view results (e.g.
    `Unteroffizier` — Unteroffizier and above can view submissions), and
    optionally which Kachel the results view appears in
- Forms are not available to `public`. The minimum submit role defaults to
  `Soldat` if omitted, and a configured `public` submit role is treated as
  `Soldat`.
- A form host Kachel can render its result table directly. Example:
  `/k/wk-admin` shows the Essensbestellung results inline and exposes a
  "Neue Eingabe / Essensbestellung" action that opens `/forms/essensbestellung`.
- The planned general form categories are: Essensbestellung, Quiz and
  Standard Formular. Categories may minimally adjust the rendered form UI.
- Generic server-side renderer turns the schema into an HTML form; the
  server checks `submitAccess` before rendering/accepting submissions, and
  `resultsAccess` before rendering the results view.
- Submissions stored as **one JSON file per submission**:
  `data/forms/<form-id>/<timestamp>-<uuid>.json`. This avoids file-locking
  issues entirely (each write is a new file) and keeps data
  inspectable/backupable via plain file tools (rsync, etc.).
- `users.yaml`: single file containing accounts + assigned role
  (`admin`/`Offizier`/`Unteroffizier`/`Soldat`); small, rarely changes —
  fine to read into memory at startup and edit by hand or via an admin
  route.

## Deployment Story

- Single Node/Bun process, runnable with `npm start` / `bun run start` or
  packaged via `pkg`/`nexe`/Bun compile for a near-single-binary experience.
- Optional Docker image:
  `docker run -p 80:8080 -v ./content:/content -v ./data:/data <image>`
- Discoverable on LAN via mDNS (`*.local`) or a printed QR code with the
  LAN IP, so devices can connect to the local server without internet.

## Conventions / Style

- Keep dependencies minimal — every new dependency raises the bar for
  "easy for other orgs to deploy/contribute."
- Prefer plain file I/O over abstractions; the data model should be
  legible by opening files directly (JSON/YAML), no opaque binary formats.
- Content authors (often non-developers) interact only with `/content`,
  `/protected`, and `/forms/*.yaml` — keep these human-editable and
  documented.
- Avoid adding a build step for content if possible; markdown should be
  renderable directly by the running server.

## Decisions taken (first draft)

These resolve the previously open questions and reflect the current code.

- **Server**: Node + Express (not Fastify, not Bun). Single ESM process,
  port `8080` (override with `PORT=`).
- **Frontend**: zero build step. Server renders HTML via small string
  templates in `server/templates/index.js`; client is vanilla JS
  (`client/app.js`) + hand-written CSS (`client/styles.css`).
- **Auth**: stateless signed-cookie sessions, HMAC-SHA256 over
  `{username, role}` with a 32-byte secret from `SESSION_SECRET` or
  auto-generated and persisted to `data/.session-secret`. Passwords
  hashed with **bcryptjs** (pure JS, no native build) in local
  `data/users.yaml`. The repository tracks `data/users.example.yaml` with
  default demo accounts; the real runtime file is ignored by Git.
- **Service worker**: hand-written (no Workbox), served dynamically from
  `/service-worker.js`. Precaches `/`, public `/k/...` routes, `/content/**`
  and static client assets. Navigation requests are network-first and cache
  successful responses as the last online state. Static/content assets remain
  cache-first.
- **Protected content**: LAN-only for fresh reads/writes. Previously visited
  protected pages can be shown from cache while offline, based on the last
  authenticated online access on that device.
- **Nested Kacheln**: `layout.yaml` supports a flat list, but a Kachel
  may have `children` (rendered as a sub-grid). Forms attach themselves
  to a host Kachel via `submitKachel` / `resultsKachel` in the form
  JSON, so adding a form is a single-file drop — no `layout.yaml` edit.
  This supersedes the spec's `kachel:` field name with `submitKachel`
  (plus `resultsKachel` for the optional results view).
- **Auth UI**: there is no Login/Logout Kachel. The top bar shows a
  login icon in the top-right when anonymous and a logout icon (POST
  form) when signed in. The hamburger top-left opens the side nav with
  all role-visible Kacheln.
- **Accounts**: individual users and group accounts are both supported via
  `data/users.yaml`. The signed role remains valid until logout, even if
  `users.yaml` changes while the user is signed in.
- **Admin UI**: user/form/layout management will be exposed through an admin
  interface that only the `admin` role can edit.
- **Sync indicator**: timestamp `Offline-Inhalte aktualisiert: …` shown
  in small text under the top bar, written by the SW via `postMessage`
  on activate and persisted in `localStorage.lastSync`.
- **Kachel grid**: 3 columns on mobile, 4 on tablet, 6 on desktop.
  Kachel color comes from `layout.yaml`'s per-Kachel `color:` field
  (used as a top-border accent).
- **Content listings** show only directories, `.md`, and `.pdf` entries.
  Images live in the content folders but are referenced from inside
  markdown — they are not listed as standalone items.
- **Role naming** stays with the current model:
  `admin > Offizier > Unteroffizier > Soldat > public`. The `Soldat` role is
  intentional and is not renamed to `ZSO User`.

## Still open

- Admin UI for managing users/forms/layout (currently hand-edited files
  only).
- mDNS / QR-code discovery on the LAN (not yet implemented).
- Docker image (documented in `README.md` as future work, not built).
- Aggregating multiple content sources under one Kachel (current model:
  one Kachel = one `content` folder, optionally plus auto-attached form
  children).
- ToDos: targets can be roles and/or individual users. ToDos need comment
  fields for addressing specific people inside roles. Completed ToDos remain
  visible, are struck through, and are sorted after open ToDos.
