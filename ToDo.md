# PWA

## Prio 1

- [X] Offline Funktion
- [x] Mandanten Fähigkeit (Logos)
- [x] Print -> WK Hinzufügen
- [x] Farbe/Design
- [ ] MD Editor --> Fotos als MD Option
- [x] Hinzufügen von Dateien (zB MD, PDF, ...) in eine Kachel (statt den Editor öffnen, einfach file upload)
- [x] Quiz verbessern (Auswertung, was war richtig/falsch, Punkte)
- [x] WK-Archivieren
- [ ] Bugfixes

## Prio 2

- [x] Filter Auswertungn (Tabellen sortierbar und filterbar machen)
- [x] Suchfunktion (PDF Textsuche offen)
- [x] Transport Formular
- [x] Appell

## Prio 3

- [X] Fahrer/Fahrzentrale

## Bugs

- [x] ZSO Logo lädt nicht in der Offline-Version
- [ ] Auto Refresh (auch in transportzentrale, wenn eine neue bestellung rein kommt oder formulare, wenn jemand ein forms ausfüllt, usw...)
- [ ] Feldtyp Dropdown, Single Choice, Mehrfachauswahl bei Formular erstellen geht nicht, wirft immer ein Fehler
- [x] Bei mir jumpt die auswahl des WK immer wieder hin und her

## Sonstiges

- [ ] "+" Button nach unten links platzieren (oberhalb Lupe) in Home Ansicht
- [ ] "+ Feld hinzufügen" beim Formular muss unterhalb der Felder sein, sonst muss man immer nach oben scrollen (genau wie beim Quiz)
- [ ] "Optionen, eine pro Zeile" bei Formular nur einbelden, wenn benötigt vom Feld-Typ
- [ ] Add width half / third as checkbox to form/quiz (see json of existing forms)
- [ ] Compact option für Felder in Formular/Quiz Editor (Eingabefeld rechts vom text und nicht darunter) als checkbox einbauen
- [ ] Paragraph, Header und Image als Feld Typen unterstützen im Formular/Quiz Editor
- [ ] Auswertungsseite Quiz/Formular ist der Text oben zu of auf neuen Zeilen (WK-Kontext: Uno, 3 Eingabe(n), Filter, 0 ausgewählt ) -> Kompakter darstellen
- [ ] Mobile Ansicht sehen die Umbennen- und Löschen-Buttons schlecht aus, sind auf der nächsten zeile.
      --> Irgendwie finde ich dies dann auf dem mobile auch way too much. Die löschen/umbennen möglichkeiten brauchen wir ja selten, aber nehmen mega viel Platz ein und stören eigentlich beim gebrauch der App.
      Können wir ein "Edit-Mode" toggle machen in jeder Kachel ansicht? und nur wenn dieser aktiviert wird, sehen wir alle die buttons usw. Was meinst du?
- [ ] Markdown-Editor alles testen
- [ ] Wenn man in einem Subfolder ist, zeigt der zurück button zum Home und nicht in die Kachel.
- [X] Überlappende WKs in Fahreugzentrale anzeigen, wenn Transporte an diesem Tag sind.


## Prio 4
- [ ] Auto Rolle (Google/Apple Maps) -> OSRM Project
- [ ] Feedback Loop von Transport Bestellung zu Dispo und zurück
- [ ] Essensbestellung und Matbestellung an Fahrzeugauftäge anheften (braucht konsistente Architektur über Formular-Verlinkungen)