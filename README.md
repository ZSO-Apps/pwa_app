# ZSO App

A self-hostable PWA for civil-protection / ZSO organizations: public offline content + protected LAN-only content + simple file-based forms. Originally built for ZSO Brugg Region; designed to be forked by any organization.

## What's inside

- **Public Kacheln** (no login, fully offline-cached): `FU Lage`, `FU Telematik`, `Notfall-Treffpunkt`, `Unterstützung`, `Handkarten`.
- **Protected Kacheln** (require login on the org's LAN): `WK Foo` (Soldat+), `WK Information` (Uof+), `WK Admin` (Of+).
- **Forms**: not public; quiz (Soldat submits, Uof+ sees results), Essensbestellung (Of-only) and a planned Standard Formular category.
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
4. Seed users once: `npm run seed-users`, then **edit the local `data/users.yaml`** to change passwords. This runtime file is intentionally not committed.
5. Run: `npm start`. Open from another LAN device at `http://<pi-ip>:8080`.
6. (Optional) Make it a systemd service:

   ```ini
   # /etc/systemd/system/zso-app.service
   [Unit]
   Description=ZSO App
   After=network.target
   [Service]
   WorkingDirectory=/opt/zso-app
   ExecStart=/usr/bin/node server/index.js
   Environment=PORT=8080
   Restart=on-failure
   User=zso
   [Install]
   WantedBy=multi-user.target
   ```

   Then `systemctl enable --now zso-app`.

## Fork / extend

Adding things is meant to be drop-in.

- **Add public content**: drop markdown/PDFs/images into `content/<Folder>/`. Add a Kachel to `layout.yaml`:
  ```yaml
  - id: my-kachel
    title: "Meine Kachel"
    access: public
    content: content/MyFolder
    color: "#8854c0"
  ```

- **Add protected content**: put files under `protected/<Folder>/` and add a Kachel with `access: Soldat | Unteroffizier | Offizier | admin`.

- **Add a form**: drop a JSON file into `forms/`. Reference an existing Kachel id with `submitKachel` (and optionally `resultsKachel` + `resultsAccess`). No `layout.yaml` edit needed.
  ```json
  {
    "title": "Mein Formular",
    "submitKachel": "wk-admin",
    "resultsKachel": "wk-admin",
    "submitAccess": "Offizier",
    "resultsAccess": "Offizier",
    "fields": [
      {"name":"name","type":"text","label":"Name","required":true},
      {"name":"datum","type":"date","label":"Datum"}
    ]
  }
  ```
  Supported field types: `text`, `textarea`, `number`, `date`, `time`, `email`, `radio` (with `options`), `select` (with `options`). Add `"correct": "..."` on a `radio` field to auto-score in the results view (quiz mode).

- **Add a user / change passwords**: edit the local `data/users.yaml`. Generate a bcrypt hash with `node scripts/hash.js <password>`. Restart the server. Use `data/users.example.yaml` only as the committed template.

- **Sub-Kacheln (groups)**: a Kachel can act as a category — leave out `content` and let forms attach themselves via `submitKachel`. (See `wk-foo` and `wk-admin` in `layout.yaml`.)

## WK files

Jeder WK wird als eigene YAML-Datei unter `data/wk/<wk-id>.yaml` gespeichert. Ein WK hat mindestens Nummer, Name, Kader, Mannschaft und Appell-Daten. Ein Benutzer gilt als "eingetragen", wenn sein Benutzer- oder Gruppenaccount in dieser WK-Datei aufgeführt ist. Spätere Formulare können einen WK über dessen `id` referenzieren. `Offizier` und höher können WKs über die GUI erstellen; `Unteroffizier` und höher können WK-Einträge aus der WK-Information read-only öffnen. Formular-Auswertungen zeigen ebenfalls eine klickbare Spalte "Name / Titel", welche die gesendete Eingabe read-only öffnet.

Echte WK-Dateien sind lokale Laufzeitdaten. `data/wk/wk-2026-001.example.yaml` dient als Vorlage.

## How offline works

The service worker (`/service-worker.js`, generated dynamically) precaches `/`, the public `/k/...` pages, everything under `/content/`, PDFs, images and static client assets. Navigation is network-first; successful page loads are cached as the last online state. A user who was signed in can therefore still see the previously loaded role-visible pages while offline.

Write actions such as opening/submitting forms require a live connection to the local server and are greyed out when the browser is offline. Public users do not see or submit forms.

A timestamp at the top of every page (`Offline-Inhalte aktualisiert: …`) shows when the service worker last completed a precache pass.

## Project layout

```
/server         Express app (auth, layout, content, forms, SW generator)
/client         CSS, client JS, manifest, icons
/content        public markdown + PDFs (offline-cached)
/protected      markdown for Soldat/Uof/Of/admin (LAN-only)
/forms          form definitions (JSON)
/data           local runtime data, not committed
/data/users.example.yaml committed template for local users.yaml
/data/wk/*.example.yaml committed templates for one-file-per-WK data
/layout.yaml    Kachel tree + access levels
```

## License

For now: do what you want, but don't sell it as-is. The old app from which the content was carried over is property of ZSO Brugg Region.
