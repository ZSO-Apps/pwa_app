# ZSO App

ZSO App ist eine selbst hostbare PWA für Zivilschutzorganisationen. Die App kombiniert offline verfügbare Fachinhalte, rollenbasierte Kacheln, WK-bezogene Informationen, Formulare, Quiz, Appell und Transportzentrale. Die Architektur bleibt bewusst flach: Node.js mit Express, statische Client-Dateien und dateibasierte Speicherung ohne Datenbank.

## Kurzüberblick

- **Node/Express ohne Build-Schritt:** `npm start` startet direkt `server/index.js`.
- **File-based Storage:** Benutzer, Formulare, WKs, Transport- und Appell-Daten werden als YAML/JSON-Dateien gespeichert.
- **Offline-first für Lesen:** Seiten und Inhalte werden nach dem letzten Onlinezugriff lokal gecacht. Schreibaktionen sind offline deaktiviert.
- **Rollenmodell:** `Admin > Offizier > Unteroffizier > Fahrer > Soldat > public`.
- **Mandantenfähigkeit:** Organisationen liegen unter `ZSO/<Organisation>/`; die aktive Organisation wird über `ORG` oder ein Startargument gewählt.
- **Kacheln statt Dateirechte:** Sichtbarkeit wird über `layout.yaml` pro Kachel geregelt, nicht pro Datei.

## Starten

```bash
npm install
npm run seed-users        # erstellt data/users.yaml beim ersten Setup
npm run dev               # Entwicklungsmodus mit Auto-Reload via node --watch
npm start                 # startet die Generic-Organisation auf http://localhost:8080
npm start -- Weli         # startet eine konkrete Organisation aus ZSO/<Organisation>
ORG=Weli npm start        # gleiches Verhalten über Umgebungsvariable
```

Der Port kann mit `PORT=8080` gesetzt werden. Für produktive Umgebungen sollte `SESSION_SECRET` gesetzt werden; ohne Wert erzeugt die App lokal ein Secret unter `data/.session-secret`.

## Standardbenutzer

Die Vorlage liegt in `data/users.example.yaml`. Alle Beispielbenutzer verwenden initial das Passwort `ZSO1234` und müssen vor produktiver Nutzung angepasst werden.

| Benutzer | Rolle |
| --- | --- |
| `Admin` | Admin |
| `Of` | Offizier |
| `Uof` | Unteroffizier |
| `Fahrer` | Fahrer |
| `AdZS` | Soldat |

Die echte lokale Datei `data/users.yaml` ist absichtlich nicht versioniert.

## Docker

```bash
docker compose up -d --build
```

Die wichtigsten Variablen stehen in `.env.example`:

```env
APP_DOMAIN=pwa.example.local
ORG=Generic
```

`docker-compose.yml` mountet `./data` nach `/app/data`, damit Laufzeitdaten ausserhalb des Containers erhalten bleiben. Die Compose-Datei ist auf Traefik mit externem Netzwerk `proxy-network` vorbereitet.

## Projektstruktur

```text
server/                         Express-App, Auth, Kacheln, Inhalte, Formulare, WK, PWA
client/                         CSS, Browser-JavaScript, Manifest und Icons
content_generic/                generische Inhalte und Formular-/Quiz-Definitionen
ZSO/<Organisation>/             mandantenspezifische öffentliche Inhalte und Logos
content_zso_specific_public     generierter Symlink auf ZSO/<aktive Organisation>
content_zso_specific/           lokale organisationsspezifische Inhalte und WK-Inhalte
data/                           lokale Laufzeitdaten, nicht versioniert
layout.yaml                     Kacheln, Rollen und Content-Zuordnung
docs/formulare.md               Referenz für Formular-JSON
```

Die App führt Inhalte aus mehreren Quellen zusammen. Spätere Quellen übersteuern frühere Quellen bei gleichem Pfad:

1. `content_generic/`
2. `content_zso_specific_public/` als Symlink auf `ZSO/<Organisation>/`
3. `content_zso_specific/`

## Kacheln

Die Kacheln werden in `layout.yaml` definiert. Der aktuelle Stand ist:

| Kachel | Zugriff | Inhalt/Route |
| --- | --- | --- |
| FU Lage | public | `content: Lage` |
| FU Telematik | public | `content: Telematik` |
| Notfall-Treffpunkt | public | `content: NTP` |
| Unterstützung | public | `content: Unterstützung` |
| WK Organisation | Unteroffizier | `content: wk_organisation` |
| WK Infos | Soldat | `content: wk_infos`, WK-bezogen |
| WK Infos Kader | Unteroffizier | `content: wk_infos_kader`, WK-bezogen |
| Appell | Unteroffizier | `/appell` |
| Transportzentrale | Fahrer | `/transport` |
| Admin | Offizier | `content: admin` |

Admin hat immer Zugriff auf alles. Spezialkacheln wie Appell, Transportzentrale und Admin werden optisch am Ende der Kachelübersicht geführt.

## Inhalte bearbeiten

Inhaltskacheln unterstützen Markdown, PDF, Bilder, Ordner, externe Links, Formulare und Quiz. Bearbeitungsaktionen sind erst ab Unteroffizier möglich und nur online verfügbar.

In den Kachelübersichten gibt es ein `+`-Menü für neue Einträge. Innerhalb einzelner Dateien wird dieses Menü nicht angezeigt. Bestehende Einträge können über ein kompaktes Aktionsmenü umbenannt oder gelöscht werden, sofern die Rolle berechtigt ist.

Bilder zu Markdown-Dateien werden in einem versteckten Begleitordner gespeichert:

```text
Beispiel.md
Beispiel.content/
```

`*.content`-Ordner werden in der GUI nicht als normale Ordner angezeigt.

## Formulare

Formulare sind JSON-Dateien in einem Inhaltsordner. In der Übersicht erscheinen sie als Ausfüllmöglichkeit und als Auswertung. Einreichungen werden als einzelne JSON-Dateien unter `data/forms/<formular-id>/<wk-id>/` gespeichert.

Unterstützte Feldtypen im Editor:

- Text, Textbereich, Zahl, Datum, Zeit, Checkbox
- Dropdown, Single Choice, Mehrfachauswahl
- Überschrift, Absatz, Bild
- Layoutoptionen wie halbe/drittel Breite und kompakte Darstellung

Formularbilder werden in `<formular-id>.content/` abgelegt. Die vollständige technische Referenz steht in `docs/formulare.md`.

## Quiz

Quiz können über das `+`-Menü in Inhaltsordnern erstellt werden. Ein Quiz besteht aus Fragen mit Single Choice, Multiple Choice oder Freitext. Optional kann pro Frage ein Bild hinterlegt werden.

Beim Ausfüllen wird nicht angezeigt, welche Antworten richtig oder falsch waren. Die Bewertung ist erst in der Auswertung sichtbar. Quizbilder werden analog zu Formularen in einem Begleitordner `<quiz-titel>.content/` gespeichert.

## WK-Kontext

Angemeldete Benutzer arbeiten in einem aktiven WK. Der aktive WK kann über die WK-Auswahl gewechselt werden. WK-bezogene Inhalte werden dadurch aus den passenden WK-Ordnern gelesen und offline verfügbar gemacht, sobald sie online geladen wurden.

WKs werden über das WK-Formular im Admin-Bereich erfasst. Die WK-Daten liegen global unter:

```text
data/forms/wk/_global/
```

WK-bezogene Inhaltsordner werden unter anderem hier erstellt:

```text
content_zso_specific/wk_infos/<wk-id>/
content_zso_specific/wk_infos_kader/<wk-id>/
```

Archivierung wird über Tags bzw. Eigenschaften in den JSON-Dateien geregelt, nicht über separate Archivordner.

## Appell und Transport

Der Appell ist für Unteroffiziere und höher vorgesehen und arbeitet WK-bezogen. Appelllisten können importiert und pro WK geführt werden.

Die Transportzentrale ist ab Rolle Fahrer sichtbar. Transportbestellungen kommen aus Formularen und können in der Transportansicht disponiert und verfolgt werden.

## Offline-Verhalten

Die PWA cached geladene Seiten, Inhalte, Logos und statische Assets. Wenn ein Benutzer online angemeldet war, bleiben die zuletzt verfügbaren Inhalte gemäss damaliger Rolle offline lesbar.

Offline nicht erlaubt sind Transaktionen, zum Beispiel:

- Formulare absenden
- Inhalte erstellen, importieren, umbenennen oder löschen
- Quiz oder Formulare erstellen
- WKs, Appell oder Transportdaten verändern
- Benutzer verwalten

Online-Funktionen werden offline ausgegraut oder mit Hinweis blockiert.

## Logos und Branding

Organisationslogos liegen unter:

```text
ZSO/<Organisation>/logos/
```

Das allgemeine Fallback ist `zivilschutz_logo.jpg`. Optionale Organisationslogos heissen einheitlich:

- `org_logo_wide_transparent.png`
- `org_logo_wide.png`
- `org_logo_square_transparent.png`
- `org_logo_square.png`

Die genaue Reihenfolge für Header, Print und Favicon ist in `ZSO/Generic/logos/README.md` dokumentiert. Organisationsspezifische Logos sollen lokal bleiben und nicht versioniert werden; das Fallback-Logo darf versioniert werden.

## Entwicklungshinweise

- Für lokale Entwicklung `npm run dev` verwenden.
- Es gibt keinen separaten Frontend-Build.
- Server-Templates liegen unter `server/templates/`.
- Client-Verhalten liegt hauptsächlich in `client/app.js`.
- Styling liegt in `client/styles.css`.
- Neue Kacheln gehören in `layout.yaml` oder werden über die Admin-/Kachel-Funktion als Ordner unter `content_zso_specific/` erstellt.
- Git-Aktionen wie Pull, Push oder Commit werden bewusst nicht durch die App benötigt.

## Lizenz

Der übernommene Altinhalt stammt aus dem ZSO-Umfeld und ist projektspezifisch zu prüfen. Die technische App ist als interne, selbst hostbare Lösung für Zivilschutzorganisationen gedacht.
