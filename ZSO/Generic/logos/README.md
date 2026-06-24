# Organisationslogos

Dieser Ordner enthält das Standard-Fallback-Logo und optionale lokale Organisationslogos.

## Fallback

`zivilschutz_logo.jpg` ist das allgemeine Standardlogo. Diese Datei darf versioniert und ins Git gepusht werden. Sie wird überall verwendet, wenn kein passenderes Organisationslogo vorhanden ist.

## Lokale Organisationslogos

Die eigentlichen Organisationslogos sind in Git ignoriert, damit organisationsspezifische Logos nicht versehentlich ins Repository gelangen. Jede Organisation kann lokal Dateien mit denselben Namen ablegen oder ersetzen:

- `org_logo_wide.png`
- `org_logo_wide_transparent.png`
- `org_logo_square.png`
- `org_logo_square_transparent.png`

Die Dateien werden öffentlich unter `/logos/<dateiname>` ausgeliefert.

## Verwendungslogik

- Header: `org_logo_wide_transparent.png` → `org_logo_wide.png` → `org_logo_square_transparent.png` → `org_logo_square.png` → `zivilschutz_logo.jpg`
- Print: `org_logo_wide.png` → `org_logo_square.png` → `zivilschutz_logo.jpg`
- Favicon: `org_logo_square_transparent.png` → `org_logo_square.png` → `zivilschutz_logo.jpg`
