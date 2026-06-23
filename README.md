# ZSO App

A self-hostable PWA for civil-protection / ZSO organizations: public offline content + protected LAN-only content + simple file-based forms, all WK-scoped. Originally built for ZSO Brugg Region; designed to be forked by any organization.

## What's inside

- **Public Kacheln** (no login, fully offline-cached): `FU Lage`, `FU Telematik`, `Notfall-Treffpunkt`, `Unterstützung`, `Handkarten`.
- **Protected Kacheln** (require login on the org's LAN): `WK Organisation` (Soldat+), `Quiz` (Soldat+), `Admin` (Offizier+).
- **Forms** live inside their host Kachel's content folder and appear in the listing as two entries — `📝 Submit` and `📊 Results`. Every submission is recorded against the currently active WK.
- 5 role levels: `Admin > Offizier > Unteroffizier > Soldat > public`.

## Run it

```bash
npm install
npm run seed-users        # writes local data/users.yaml — only needed the first time
npm start                 # serves the Generic org on http://localhost:8080
npm start -- BruggRegion  # serve a specific organization (folder under ZSO/)
ORG=Weli npm start        # same, via environment variable
```

Default users from `data/users.example.yaml` (all password `ZSO1234` — change before deploying!):

| Username | Role           |
|----------|----------------|
| `Admin`  | Admin          |
| `Of`     | Offizier       |
| `Uof`    | Unteroffizier  |
| `AdZS`   | Soldat         |

Override the port with `PORT=80 npm start`. Set `SESSION_SECRET=<32+ random chars>` for production (otherwise auto-generated and persisted to `data/.session-secret`).

## Organizations — `ZSO/<Org>/`

The app is multi-tenant: each organization has a folder `ZSO/<Org>/` holding its
public branding (`logos/`) and public content/Handkarten/documents that other
orgs don't need. Pick the org at startup with `npm start -- <Org>` or
`ORG=<Org> npm start` (default: `Generic`).

At startup the server points the fixed path `content_zso_specific_public` at
`ZSO/<Org>` via a symlink — so logos, `/logos`, and the org's public content all
resolve to the chosen org without further configuration. The symlink itself is
generated and git-ignored; `ZSO/` is the tracked source of truth. Each org
folder must contain its own default `logos/zivilschutz_logo.jpg` fallback.

To add an organization: create `ZSO/<NewOrg>/`, drop in `logos/` (at least the
fallback logo, optionally `org_logo_*.png` branding) and any public content
folders (e.g. `Lage/`, `NTP/`, Handkarten), then start with `ORG=<NewOrg>`.

## Deploy on a Raspberry Pi / NAS / old PC

1. Install Node ≥ 18 (`apt install nodejs npm` or the official Node ARM build).
2. Copy this folder to the device (`rsync`, USB stick, `git clone`).
3. Production install: `npm ci --omit=dev`.
4. Seed users once: `npm run seed-users`, then **edit the local `data/users.yaml`** to change passwords.
5. Run: `npm start`. Open from another LAN device at `http://<pi-ip>:8080`.
6. (Optional) Make it a systemd service (see commit history for an example unit file).

## Content layout — the three roots

Content lives in **three parallel roots** that are merged at runtime per Kachel
(later wins on collision):

| Root | Purpose |
|------|---------|
| `content_generic/`             | generic content shipped with the project |
| `content_zso_specific_public/` | the active org's public content (symlink → `ZSO/<Org>`) |
| `content_zso_specific/`        | org-specific overrides/additions (highest priority) |

A Kachel only names a slug; the server unions all three roots:

```yaml
- id: handkarten
  title: "Handkarten"
  access: public            # access is decided here, not by the folder
  content: Handkarten       # → content_generic/Handkarten + content_zso_specific/Handkarten
  color: "#2f80ed"
```

If several roots contain a file at the same path, the later one wins:
`content_zso_specific/` overrides the org public folder, which overrides
`content_generic/`. Access is governed **only** by the Kachel's `access:` in
`layout.yaml` — the same roots serve public and protected Kacheln alike.

### Per-WK Kacheln (`wkScoped`)

A Kachel with `wkScoped: true` shows content for the **active WK** only; its
effective slug is `<content>/<active-wk-id>`. The two such Kacheln are
`WK Infos` (`Soldat`) and `WK Infos Kader` (`Unteroffizier`). Their per-WK
folders (`content_zso_specific/wk_infos/<wk-id>/` and `…/wk_infos_kader/<wk-id>/`)
are created automatically when a WK is erfasst. Folders may contain subfolders,
shown with a folder icon and navigable recursively.

## Forms

A form is a single `.json` file dropped into any content folder. It shows up in that Kachel's listing as **two entries**: 📝 (submit) and 📊 (results).

Example: `content_generic/quiz/quiz-leitungsbau.json`

```json
{
  "id": "quiz-leitungsbau",
  "title": "Quiz Leitungsbau",
  "submitLabel": "Quiz Leitungsbau",
  "resultsLabel": "Quiz-Auswertung Leitungsbau",
  "submitAccess": "Soldat",
  "resultsAccess": "Unteroffizier",
  "fields": [
    { "name": "frage1", "type": "radio", "label": "…", "options": ["A","B"], "correct": "A", "required": true }
  ]
}
```

Field types: `text`, `textarea`, `number`, `date`, `time`, `email`, `checkbox`, `radio` / `select` with `options`. Display-only elements: `heading`, `paragraph`, `signature`. Modifiers: `width` (`half`/`third`/`quarter`), `printOnly` (print-only checklist items), `correct` (quiz auto-scoring).

Optional `"scope": "global"` makes a form WK-independent (used only by the WK form itself).

**Full authoring reference (German):** see [`docs/formulare.md`](docs/formulare.md) — all element types, modifiers, layout, printing and a complete example.

## WK context

Every logged-in user works inside the context of one **active WK**. The second banner below the top bar shows it and offers a dropdown to switch.

- WKs are created by submitting the `wk` form in **Admin → WK erfassen** (`content_generic/admin/wk.json`). Creating a WK auto-creates its `wk_infos` / `wk_infos_kader` folders under `content_zso_specific/`.
- WK records are stored at `data/forms/wk/_global/<id>.json`.
- The server auto-selects the WK whose start/end range is closest to today.
- Every other form submission is stored at `data/forms/<form-id>/<active-wk-id>/<timestamp>-<uuid>.json`.
- Results views are automatically scoped to the active WK.
- If no WK exists yet, forms (except the WK form itself) are blocked until one is created.

## How offline works

The service worker precaches `/`, public `/k/…` pages and their assets. Navigation is network-first; successful page loads are cached as the last online state, so a user who was signed in can still see previously loaded role-visible pages while offline.

Write actions (form submissions, WK creation) require a live connection to the local server and are greyed out when the browser is offline. Public users do not see or submit forms.

A timestamp at the top of every page (`Offline-Inhalte aktualisiert: …`) shows when the service worker last completed a precache pass.

## Project layout

```
/server                              Express app (auth, layout, content, forms, WK, SW generator)
/client                              CSS, client JS, manifest, icons
/content_generic                     generic content (incl. admin/, quiz/, wk_organisation/)
/ZSO/<Org>/                          per-org public branding (logos/) + public content
/content_zso_specific_public         symlink → ZSO/<active Org> (generated, git-ignored)
/content_zso_specific                org-specific overrides/additions (incl. per-WK wk_infos/)
/data                                local runtime data, not committed
/data/users.example.yaml             committed template for local users.yaml
/data/forms/<form-id>/<wk-id>/…      one JSON per submission
/data/forms/wk/_global/…             WK records themselves (global scope)
/layout.yaml                         Kachel tree + access levels (content slug only)
```

## License

For now: do what you want, but don't sell it as-is. The old app from which the content was carried over is property of ZSO Brugg Region.
