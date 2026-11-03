# Spec: Persönliches Kochbuch (PWA)

Original brief from the owner (2026-11-03), verbatim. Stack decision: Cloudflare (Workers + D1 + Access + Workers AI) — see `docs/superpowers/plans/2026-11-03-kochbuch-mvp.md`.

Note: the brief mentions attached design screenshots; none were provided yet. Design follows the values below until they arrive.

---

Baue eine mobile-first Web-App (PWA): ein persönliches Kochbuch, das Rezepte aus Instagram, YouTube und anderen Quellen importiert und in dem ich jedes Rezept für mich anpassen kann. Alle Texte auf Deutsch. Orientiere dich am Design der angehängten Screenshots.

KERNIDEE
Jedes Rezept hat ein unverändertes ORIGINAL und darüber eine Ebene mit MEINEN ANPASSUNGEN. Anpassungen werden getrennt vom Original gespeichert, damit ich immer sehe, was ich geändert habe, und jede Änderung einzeln zurücksetzen kann.

SCREENS
1. Mein Kochbuch (Startseite)
- Überschrift "Mein Kochbuch", Suchfeld (sucht in Rezeptnamen und Zutaten)
- Filter-Chips: Alle, Angepasst, Unter 30 Min, plus eigene Tags
- Rezeptkarten: Bild, Name, Zeit, Portionen, Quelle (Instagram/YouTube/Web), Badge "X Anpassungen" in Orange, wenn das Rezept angepasst wurde
- Großer Button unten: "Rezept hinzufügen"

2. Rezept hinzufügen
- Umschalter: "Link einfügen" oder "Text einfügen"
- Bei Text: Ich füge Caption oder Rezepttext ein. Eine KI wandelt das in ein strukturiertes Rezept um: Titel, Portionen, Gesamtzeit, Zutatenliste (Name, Menge, Einheit), Schritte (Text, optional Dauer in Minuten)
- Vorschau mit "Rezept erkannt", Anzahl Zutaten/Schritte/Zeit und Quelle
- Hinweis: "Bitte kurz prüfen, Mengen aus dem Video können fehlen"
- Button "Ins Kochbuch speichern"

3. Rezept-Detail
- Bild oben, Button "Original" öffnet die Quell-URL
- Portionen-Regler (+/-), der alle Mengen umrechnet
- Banner: "X eigene Anpassungen" mit Button "Original zeigen" (zeigt temporär das unveränderte Rezept)
- Tabs: Zutaten | Schritte
- Jede Zutat und jeder Schritt hat ein Stift-Icon zum Bearbeiten (Menge, Einheit, Name, Dauer, Text)
- Geänderte Einträge: orange hinterlegt, mit Hinweis "Geändert · Original 120 g"
- Hinzugefügte Einträge: orange, mit "Von dir hinzugefügt"
- Gelöschte Original-Einträge: durchgestrichen, wiederherstellbar
- Button "Zutat hinzufügen" und "Schritt hinzufügen"
- Freitextfeld "Notiz für mich"
- Button unten: "Kochen starten"

4. Kochmodus
- Dunkelgrüner Vollbild-Screen, ein Schritt pro Ansicht, große Schrift
- Fortschrittsbalken "Schritt 3 von 6"
- Wenn der Schritt angepasst ist: Hinweis "Deine Anpassung: +2 Min"
- Timer mit der angepassten Dauer, zeigt "Original 6 Min · bei dir 8 Min"
- Buttons Zurück / Weiter, Bildschirm soll nicht ausgehen

DATENMODELL
- recipes: id, user_id, title, source_url, source_platform, image_url, servings, created_at
- ingredients: id, recipe_id, name, amount, unit, position (Originalwerte, nie überschreiben)
- steps: id, recipe_id, text, duration_minutes, position (Originalwerte, nie überschreiben)
- adjustments: id, recipe_id, target_type (ingredient/step), target_id (leer bei neuen Einträgen), action (modify/add/remove), new_values (JSON), created_at
- notes: recipe_id, text
Angezeigt wird immer: Original + Anpassungen zusammengeführt.

DESIGN
- Hintergrund #FAFAF7, Text #1A1A17, Primärfarbe Dunkelgrün #1F4D3A
- Anpassungen immer in Orange: Text #A33F0C, Hintergrund #FDEBDD
- Schriften: "Bricolage Grotesque" für Überschriften, "DM Sans" für Text
- Abgerundete Karten, große Touch-Flächen (mind. 44px), keine Emojis

TECHNIK
- Login per E-Mail, jeder sieht nur seine eigenen Rezepte
- Als PWA installierbar (zum Home-Bildschirm hinzufügen)
- Im ersten Schritt nur "Text einfügen" umsetzen. Den automatischen Import per Link bauen wir später.
