# Formulare & Quizze

Diese Anleitung richtet sich an **Inhalts-Autorinnen und -Autoren**. Sie
beschreibt, wie man Formulare (inkl. Quizze) anlegt – ohne Programmier­kenntnisse,
nur durch das Bearbeiten einer JSON-Datei.

Ein **Quiz ist technisch dasselbe wie ein Formular**: gleiche Datei, gleiche
Felder. Der einzige Unterschied ist, dass Quiz-Fragen eine `correct`-Angabe
(richtige Antwort) haben – siehe [Quiz](#quiz).

---

## 1. Was ist ein Formular?

Ein Formular ist **eine einzige JSON-Datei**, die irgendwo in einen der
Content-Ordner gelegt wird, z.B.:

```
content_protected/wk_organisation/essensbestellung.json
content_protected/quiz/quiz-leitungsbau.json
```

- **Wo die Datei liegt, bestimmt, in welcher Kachel das Formular erscheint.**
  Legst du sie in den Ordner einer Kachel, taucht sie in deren Liste auf.
- Jedes Formular erscheint in der Liste als **zwei Einträge**:
  - 📝 **Ausfüllen** (Beschriftung aus `submitLabel`)
  - 📊 **Auswertung** (Beschriftung aus `resultsLabel`)
  Jeder der beiden Einträge wird einzeln über die Zugriffsstufe gefiltert
  (`submitAccess` bzw. `resultsAccess`).
- Eingaben werden als **je eine JSON-Datei pro Absendung** gespeichert unter
  `data/forms/<formular-id>/<wk-id>/…`. Sie sind dem **aktiven WK** zugeordnet;
  die Auswertung zeigt automatisch nur Einträge des aktiven WK.

> Formulare sind nie öffentlich – sie erfordern immer einen Login und eine
> Verbindung zum lokalen Server.

---

## 2. Grundgerüst einer Formular-Datei

```json
{
  "id": "essensbestellung",
  "title": "Essensbestellung",
  "submitLabel": "Essensbestellung",
  "resultsLabel": "Essensbestellungen Übersicht",
  "submitAccess": "Soldat",
  "resultsAccess": "Offizier",
  "fields": [
    { "type": "heading", "label": "Besteller" },
    { "name": "name", "type": "text", "label": "Name", "required": true }
  ]
}
```

### Felder auf oberster Ebene

| Schlüssel        | Pflicht | Bedeutung |
|------------------|---------|-----------|
| `id`             | empfohlen | Eindeutige Kennung. Wird sie weggelassen, wird der Dateiname (ohne `.json`) verwendet. Bei doppelter `id` gewinnt die spezifischere Datei (ZSO-spezifisch / protected vor generic). |
| `title`          | ja | Titel des Formulars (Überschrift der Detailansicht & des Ausdrucks). |
| `submitLabel`    | empfohlen | Beschriftung des 📝-Eintrags in der Liste. Fehlt sie, wird `title` benutzt. |
| `resultsLabel`   | empfohlen | Beschriftung des 📊-Eintrags. Fehlt sie, „Auswertung title". |
| `submitAccess`   | nein | Mindest-Rolle zum Ausfüllen. Standard `Soldat`. `public` wird wie `Soldat` behandelt (Formulare sind nie öffentlich). |
| `resultsAccess`  | nein | Mindest-Rolle für die Auswertung. **Fehlt sie, gibt es keinen 📊-Eintrag.** |
| `scope`          | nein | Nur für das WK-Formular: `"global"`. Siehe [WK-Kontext](#wk-kontext). |
| `fields`         | ja | Liste der Elemente (Eingabefelder + Anzeige-Elemente), in Reihenfolge. |

**Rollen-Hierarchie** (jede Rolle schliesst die darunter ein):

```
admin > Offizier > Unteroffizier > Soldat > public
```

---

## 3. Eingabe-Elemente

Eingabe-Elemente haben einen technischen `name` (eindeutig pro Formular, ohne
Leerzeichen/Umlaute), unter dem der Wert gespeichert wird. Sie erscheinen als
Spalte in der Auswertung.

| `type`     | Beschreibung | Besonderheiten |
|------------|--------------|----------------|
| `text`     | Einzeiliges Textfeld | |
| `number`   | Zahl | `min`, `max` möglich |
| `date`     | Datum | |
| `time`     | Uhrzeit | |
| `email`    | E-Mail-Adresse | |
| `textarea` | Mehrzeiliger Text | |
| `radio`    | Auswahl (genau eine Option) | benötigt `options` |
| `select`   | Auswahl per Dropdown | benötigt `options` |
| `checkbox` | Ja/Nein-Häkchen | wird als ✓/☐ gespeichert/angezeigt |

> Unbekannte Typen werden als einfaches Textfeld dargestellt.

### Gemeinsame Eigenschaften von Eingabefeldern

| Schlüssel  | Bedeutung |
|------------|-----------|
| `name`     | **Pflicht.** Technische Kennung, eindeutig im Formular. |
| `label`    | Sichtbare Beschriftung. |
| `required` | `true` = Pflichtfeld (wird beim Absenden geprüft). |
| `options`  | Liste der Auswahlmöglichkeiten (`radio`, `select`). |
| `min`/`max`| Grenzwerte für `number`. |
| `correct`  | Richtige Antwort → macht das Feld zur Quizfrage (siehe [Quiz](#quiz)). |
| `width`    | Breite, siehe [Layout](#5-layout-breite). |
| `compact`  | `true` = Beschriftung und ein kleineres Eingabefeld nebeneinander, siehe [Kompakt](#5b-kompakte-felder-compact). |
| `printOnly`| Nur im Ausdruck sichtbar, siehe [printOnly](#6-nur-fuer-den-ausdruck-printonly). |

**Beispiele:**

```json
{ "name": "anzahl", "type": "number", "label": "Anzahl Personen", "required": true, "min": 1 }
```
```json
{ "name": "verpflegung", "type": "radio", "label": "Verpflegungsart",
  "options": ["Frühstück", "Mittagessen", "Abendessen"], "required": true }
```
```json
{ "name": "bestaetigt", "type": "checkbox", "label": "Ich bestätige die Angaben." }
```

---

## 4. Anzeige-Elemente (ohne Eingabe)

Diese Elemente nehmen **keine Eingabe** entgegen, werden **nicht gespeichert**
und erscheinen **nicht** als Spalte in der Auswertung. Sie dienen der Gliederung.

| `type`      | Beschreibung | Schlüssel |
|-------------|--------------|-----------|
| `heading`   | Abschnitts-Banner (grau, optional farbig) zum Unterteilen | `label`, optional `color` |
| `paragraph` | Textblock (Inline-**Markdown** erlaubt: `**fett**`, `*kursiv*`, Links) | `text` |
| `signature` | Unterschriftslinie (v.a. für den Ausdruck) | `label` |

**Beispiele:**

```json
{ "type": "heading", "label": "Besteller" }
```
```json
{ "type": "heading", "label": "Wichtig", "color": "#e8772e" }
```
```json
{ "type": "paragraph", "text": "Bitte pro Person eine Bestellung. Änderungen sind **bis 24h vorher** möglich." }
```

> Im `text` ist **Inline-Markdown** erlaubt – `**fett**`, `*kursiv*`, `` `code` ``
> und Links – gleich wie in den normalen Inhalts-Seiten.
```json
{ "type": "signature", "label": "Unterschrift Fourier" }
```

> **Beschreibung zum Formular:** Dafür einfach ein `paragraph`-Element ganz oben
> einfügen.

---

## 5. Layout: Breite

Standardmässig nimmt jedes Element eine ganze Zeile ein. Mit `width` lassen sich
mehrere Elemente nebeneinander setzen – die Elemente fliessen von links nach
rechts, und was zusammen in eine Zeile passt, landet auf einer Zeile.

| `width`     | Breite |
|-------------|--------|
| (weglassen) | volle Breite |
| `"half"`    | halbe Breite |
| `"third"`   | ein Drittel |
| `"quarter"` | ein Viertel |

```json
{ "name": "name",   "type": "text", "label": "Name",   "width": "half" },
{ "name": "mobile", "type": "text", "label": "Mobile", "width": "half" }
```
→ „Name" und „Mobile" stehen nebeneinander auf einer Zeile.

Ein `heading` (volle Breite) beginnt immer eine neue Zeile – so bleiben
Abschnitte sauber getrennt. Das Layout gilt im Ausfüll-Formular **und** in der
Detail-/Druckansicht.

---

## 5b. Kompakte Felder: `compact`

Standardmässig steht die Beschriftung **über** dem Eingabefeld, das die ganze
Zeile breit ist. Mit `"compact": true` stehen Beschriftung und ein **kleineres
Eingabefeld nebeneinander** auf einer Zeile – praktisch für kurze Eingaben wie
Zahlen oder Uhrzeiten.

```json
{ "name": "anzahl", "type": "number", "label": "Anzahl Personen", "compact": true }
```
→ „Anzahl Personen [__]" auf einer Zeile statt gestapelt.

- Wirkt sowohl im **Ausfüll-Formular** als auch in der **Detail-/Druckansicht**
  einer Eingabe (dort steht der Wert direkt hinter der Beschriftung).
- Sinnvoll v.a. für `number`, `date`, `time`, `text` und `select`. Bei
  `checkbox` und Anzeige-Elementen (`heading`, `paragraph`, `signature`) hat es
  keine Wirkung – sie stehen ohnehin schon kompakt.
- Lässt sich mit `width` kombinieren: z.B. zwei kompakte Felder als `half`
  nebeneinander.
- Auf schmalen Bildschirmen bricht ein zu langes Label/Feld bei Bedarf um.

---

## 6. Nur für den Ausdruck: `printOnly`

Mit `"printOnly": true` wird ein Element **beim Ausfüllen ausgeblendet** und
erscheint nur in der **Detailansicht und im Ausdruck**. So lassen sich
Checklisten anlegen, die später von Hand (auf Papier) ausgefüllt werden – z.B.
Bestätigungs-Häkchen und Unterschriften für Fourier / Kü Uof.

`printOnly` funktioniert auf **jedem** Element-Typ (Felder, Banner, Unterschrift).
PrintOnly-Eingabefelder werden in der Detailansicht als leere Kästchen/Linien
zum handschriftlichen Ausfüllen dargestellt.

```json
{ "type": "heading", "label": "Fourier", "printOnly": true },
{ "type": "checkbox", "name": "f_kopie", "label": "Kopie für Kursakten abgelegt.", "printOnly": true },
{ "type": "signature", "label": "Unterschrift Fourier", "printOnly": true }
```

### Drucken

Ein Formular wird über die normale **Druckfunktion des Browsers** (`Strg`/`Cmd`
+ `P`) auf der Detailansicht einer Eingabe ausgedruckt. Kopfzeile, Navigation
usw. werden dabei automatisch ausgeblendet.

---

## 7. Name/Mobile automatisch merken

Felder mit dem technischen Namen **`name`** oder **`mobile`** (Gross-/Klein­schreibung
egal) werden **pro Gerät im Browser gemerkt** und beim nächsten Öffnen eines
Formulars automatisch vorausgefüllt.

Hintergrund: Accounts sind generisch pro Rolle (z.B. ein gemeinsamer
„Offizier"-Login). So muss eine Person Name/Mobile nur einmal eingeben und nicht
bei jedem Formular erneut.

```json
{ "name": "name",   "type": "text", "label": "Name" },
{ "name": "mobile", "type": "text", "label": "Mobile" }
```

---

## 8. Quiz

Ein Quiz ist ein normales Formular. Eine Frage wird zur **Quizfrage**, sobald
sie eine `correct`-Angabe hat (die richtige Antwort). In der Auswertung
erscheint dann zusätzlich eine **Zusammenfassung** mit der Anzahl richtiger
Antworten pro Person.

```json
{
  "name": "frage1",
  "type": "radio",
  "label": "Welche Spannung führt eine typische Niederspannungs-Hausleitung?",
  "options": ["230 V", "400 V", "1000 V"],
  "correct": "230 V",
  "required": true
}
```

- `correct` muss exakt einer der `options` entsprechen.
- Felder ohne `correct` (z.B. ein Kommentar-Feld) zählen nicht zur Auswertung.

---

## 9. WK-Kontext

- Jede angemeldete Person arbeitet im Kontext **eines aktiven WK** (Banner unter
  der Kopfzeile, mit Auswahl).
- Eingaben werden automatisch dem aktiven WK zugeordnet
  (`data/forms/<formular-id>/<wk-id>/…`); die Auswertung zeigt nur Einträge des
  aktiven WK.
- Ist noch kein WK angelegt, melden Ausfüllen/Auswertung einen Hinweis
  (Admin → WK erfassen). Das Lesen normaler Inhalte ist davon nicht betroffen.

### Das WK-Formular selbst (`scope: "global"`)

Die WKs sind selbst Formular-Einträge des WK-Formulars
(`content_protected/admin/wk.json`). Dieses trägt `"scope": "global"`, wodurch
seine Einträge **nicht** WK-spezifisch, sondern global gespeichert werden
(`data/forms/wk/_global/…`). Der Server wählt automatisch den WK, dessen
Zeitraum (`start`…`ende`) am nächsten zu heute liegt.

> `scope: "global"` ist ausschliesslich für das WK-Formular gedacht.

---

## 10. Vollständiges Beispiel

```json
{
  "id": "essensbestellung",
  "title": "Essensbestellung",
  "submitLabel": "Essensbestellung",
  "resultsLabel": "Essensbestellungen Übersicht",
  "submitAccess": "Offizier",
  "resultsAccess": "Offizier",
  "fields": [
    { "type": "paragraph", "text": "Bitte pro Verpflegung eine Bestellung erfassen." },

    { "type": "heading", "label": "Besteller" },
    { "name": "name",   "type": "text",   "label": "Name",      "required": true, "width": "half" },
    { "name": "mobile", "type": "text",   "label": "Mobile",                      "width": "half" },
    { "name": "datum",  "type": "date",   "label": "Datum",     "required": true, "width": "half" },
    { "name": "ort",    "type": "text",   "label": "Standort",  "required": true, "width": "half" },
    { "name": "anzahlFleisch",     "type": "number", "label": "Anzahl Fleisch",     "required": true, "width": "half" },
    { "name": "anzahlVegetarisch", "type": "number", "label": "Anzahl Vegetarisch", "width": "half" },
    { "name": "verpflegungsart", "type": "radio", "label": "Verpflegungsart",
      "options": ["Frühstück", "Zwipf", "Mittagessen", "Abendessen"], "required": true, "width": "half" },
    { "name": "kommentar", "type": "textarea", "label": "Kommentar", "width": "half" },

    { "type": "heading", "label": "Fourier", "printOnly": true },
    { "type": "checkbox", "name": "f_beruecksichtigt", "label": "Bei der Konsolidierung berücksichtigt.", "printOnly": true },
    { "type": "checkbox", "name": "f_kopie", "label": "Kopie für Kursakten abgelegt.", "printOnly": true, "width": "half" },
    { "type": "signature", "label": "Unterschrift Fourier", "printOnly": true, "width": "half" }
  ]
}
```

---

## 11. Spickzettel

```
Eingabe-Typen : text, number, date, time, email, textarea, radio, select, checkbox
Anzeige-Typen : heading, paragraph, signature
Modifier      : width (half|third|quarter), compact, printOnly, required,
                correct (Quiz), options, min, max, color (heading)
Zugriff       : submitAccess, resultsAccess  →  admin > Offizier > Unteroffizier > Soldat
Merken        : Felder namens "name"/"mobile" werden pro Gerät vorausgefüllt
Drucken       : Detailansicht einer Eingabe → Browser-Druck (Strg/Cmd+P)
```
