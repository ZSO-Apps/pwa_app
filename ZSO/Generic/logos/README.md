# Organisationslogos

Dieser Ordner enthält das Standard-Fallback-Logo und beschreibt die erwarteten Dateinamen für organisationsspezifische Logos.

## Organisationen

Die aktive Organisation wird beim Start über `ORG` oder über ein Startargument gewählt:

```bash
ORG=Weli npm start
npm start -- Weli
```

Der Server setzt danach `content_zso_specific_public` als Symlink auf `ZSO/<Organisation>/`. Dadurch werden die Logos der aktiven Organisation unter `/logos/<dateiname>` ausgeliefert.

## Fallback

`zivilschutz_logo.jpg` ist das allgemeine Standardlogo. Diese Datei darf versioniert und ins Git gepusht werden. Sie wird überall verwendet, wenn kein passenderes Organisationslogo vorhanden ist.

## Lokale Organisationslogos

Die eigentlichen Organisationslogos sind organisationsspezifisch und sollen nicht ins Git aufgenommen werden. Jede Organisation kann lokal Dateien mit denselben Namen ablegen:

- `org_logo_wide_transparent.png`
- `org_logo_wide.png`
- `org_logo_square_transparent.png`
- `org_logo_square.png`

Diese generischen Dateinamen sind bewusst stabil, damit jede Organisation ihre eigenen Logos ersetzen kann, ohne Code oder Konfiguration anzupassen.

## Verwendungslogik

Header:

1. `org_logo_wide_transparent.png`
2. `org_logo_wide.png`
3. `org_logo_square_transparent.png`
4. `org_logo_square.png`
5. `zivilschutz_logo.jpg`

Print:

1. `org_logo_wide.png`
2. `org_logo_square.png`
3. `zivilschutz_logo.jpg`

Favicon:

1. `org_logo_square_transparent.png`
2. `org_logo_square.png`
3. `zivilschutz_logo.jpg`

## Hinweise

- Nach dem Wechsel der Organisation sollte der Server neu gestartet werden.
- Logos werden von der PWA gecacht und sind nach dem Laden auch offline verfügbar.
- Falls ein Logo im Browser nicht erscheint, zuerst prüfen, ob die aktive Organisation korrekt gesetzt ist und ob die Datei im Ordner `ZSO/<Organisation>/logos/` liegt.
