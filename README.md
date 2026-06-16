# ZSO App

A self-hostable PWA for civil-protection / ZSO organizations: public offline content + protected LAN-only content + simple file-based forms, all WK-scoped. Originally built for ZSO Brugg Region; designed to be forked by any organization.

## What's inside

- **Public Kacheln** (no login, fully offline-cached): `FU Lage`, `FU Telematik`, `Notfall-Treffpunkt`, `Unterstützung`, `Handkarten`.
- **Protected Kacheln** (require login on the org's LAN): `WK Organisation` (Soldat+), `Quiz` (Soldat+), `Admin` (Offizier+).
- **Forms** live inside their host Kachel's content folder and appear in the listing as two entries — `📝 Submit` and `📊 Results`. Every submission is recorded against the currently active WK.
- 5 role levels: `admin > Offizier > Unteroffizier > Soldat > public`.

## Run it

```bash
npm install
npm run seed-users   # writes local data/users.yaml — only needed the first time
npm start            # serves on http://localhost:8080
```

Default users from `data/users.example.yaml` (all password `ZSO1234` — change before deploying!):

| Username | Role           |
|----------|----------------|
| `admin`  | admin          |
| `Of`     | Offizier       |
| `Uof`    | Unteroffizier  |
| `AdZS`   | Soldat         |

Override the port with `PORT=80 npm start`. Set `SESSION_SECRET=<32+ random chars>` for production (otherwise auto-generated and persisted to `data/.session-secret`).

## Deploy on a Raspberry Pi / NAS / old PC

1. Install Node ≥ 18 (`apt install nodejs npm` or the official Node ARM build).
2. Copy this folder to the device (`rsync`, USB stick, `git clone`).
3. Production install: `npm ci --omit=dev`.
4. Seed users once: `npm run seed-users`, then **edit the local `data/users.yaml`** to change passwords.
5. Run: `npm start`. Open from another LAN device at `http://<pi-ip>:8080`.
6. (Optional) Make it a systemd service (see commit history for an example unit file).

## Content layout — the four roots

Content lives in **four parallel roots** that are merged at runtime per Kachel:

| Root | Login required? | Purpose |
|------|-----------------|---------|
| `content_public/`              | no  | generic public content, shipped with the project |
| `content_zso_specific_public/` | no  | org-specific public overrides/additions |
| `content_protected/`              | yes | generic protected content |
| `content_zso_specific_protected/` | yes | org-specific protected overrides/additions |

A Kachel only names a slug; the server unions all four roots:

```yaml
- id: handkarten
  title: "Handkarten"
  access: public            # public Kachel → only the *_public roots are used
  content: Handkarten       # → content_public/Handkarten + content_zso_specific_public/Handkarten
  color: "#2f80ed"
```

If two roots contain a file at the same path, the more specific wins (ZSO-specific over generic, protected over public).

For a Kachel with `access >= Soldat`, all four roots are merged so the same slug can hold both public (offline-cachable) and protected (LAN-only) material.

## Forms

A form is a single `.json` file dropped into any content folder. It shows up in that Kachel's listing as **two entries**: 📝 (submit) and 📊 (results).

Example: `content_protected/quiz/quiz-leitungsbau.json`

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

Field types: `text`, `textarea`, `number`, `date`, `time`, `email`, `radio` / `select` with `options`. Add `"correct": "…"` on a `radio` field for auto-scoring in the results view.

Optional `"scope": "global"` makes a form WK-independent (used only by the WK form itself).

## WK context

Every logged-in user works inside the context of one **active WK**. The second banner below the top bar shows it and offers a dropdown to switch.

- WKs are created by submitting the `wk` form in **Admin → WK erfassen** (`content_protected/admin/wk.json`).
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
/content_public                      generic public content
/content_zso_specific_public         org-specific public content
/content_protected                   generic protected content (incl. admin/, quiz/, wk_organisation/)
/content_zso_specific_protected      org-specific protected content
/data                                local runtime data, not committed
/data/users.example.yaml             committed template for local users.yaml
/data/forms/<form-id>/<wk-id>/…      one JSON per submission
/data/forms/wk/_global/…             WK records themselves (global scope)
/layout.yaml                         Kachel tree + access levels (content slug only)
```

## License

For now: do what you want, but don't sell it as-is. The old app from which the content was carried over is property of ZSO Brugg Region.
