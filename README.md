# Fenster – Livestream-Bilderrahmen

Schlanke Web-App, die 24/7 auf einem Tablet im Holzbilderrahmen läuft und einen YouTube-Livestream wie ein Fenster in eine andere Welt zeigt, auf Wunsch mit Passepartout. Umgesetzt nach dem Design-Handoff „Variante 1b – Wohnlich“ (Bildschild wie im Museum, Galerie-Menü mit Passepartout).

Läuft auf iPad (Safari, Home-Bildschirm) und Android (Chrome als installierte App oder Fully Kiosk Browser). Reines HTML/CSS/JavaScript, kein Build-Schritt, kein Backend.

| Datei | Inhalt |
|---|---|
| `index.html` | Seitengerüst |
| `styles.css` | Gestaltung nach Design-Tokens (Spectral, Salbei-Akzent, Glas-Elemente). Alle Masse beziehen sich auf das Referenz-Artboard 1194 × 834 und werden auf das Gerät skaliert |
| `app.js` | Player, Overlay, Menü, YouTube-Suche, Einstellungen, Fehlerbehandlung, Wake Lock, täglicher Reload |
| `streams.json` | Startliste der Livestreams beim allerersten Start |
| `manifest.webmanifest`, `icons/` | Home-Bildschirm-App (PWA) |

## Bedienung

- **Live:** Standardmässig ist nur der Stream sichtbar, im Passepartout oder randlos. Er startet stumm, ausser „Ton beim Start“ steht auf „Mit Ton“ (dann kommt der Ton mit dem ersten Tap, weil Browser Autoplay nur stumm erlauben).
- **Tippen:** blendet das Overlay ein: rechts die Favoriten-Leiste, unten mittig das Bildschild mit Menü-Knopf, Titel, Ort und Ton-Knopf. Es verschwindet nach der eingestellten Zeit (Standard 5 s) oder sofort mit einem weiteren Tipp.
- **Meine Fenster** (Menü-Knopf links im Bildschild): alle Orte als Kacheln mit Passepartout. Kachel antippen öffnet den Stream, der Stern schaltet den Favoriten um. Oben rechts „Neues Fenster“ (YouTube-Suche) und das Zahnrad für die Einstellungen.
- **Neues Fenster:** Livestreams auf YouTube suchen und mit „+“ hinzufügen. Ohne API-Schlüssel kann man einen YouTube-Link (oder eine Video-ID) ins Suchfeld einfügen.
- **Einstellungen:** Passepartout an/aus, Farbe (Creme, Weiss, Anthrazit), Breite (schmal, mittel, breit), nachts abdunkeln (22–7 Uhr), Steuerung ausblenden nach (5 s, 10 s, 30 s, nie), Ton beim Start, Favoriten wechseln (aus, stündlich, täglich), YouTube-API-Schlüssel, Startliste wiederherstellen. Links eine Live-Vorschau mit Passepartout.
- Orte, Favoriten, Einstellungen und der zuletzt gesehene Stream werden auf dem Gerät gespeichert (localStorage) und nach einem Neustart fortgesetzt.

### YouTube-Suche und API-Schlüssel

Die Suche nutzt die YouTube Data API v3 (`search.list` mit `eventType=live`, Zuschauerzahl über `videos.list`). Dafür braucht es einen kostenlosen API-Schlüssel:

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen.
2. Unter **APIs & Dienste → Bibliothek** die **YouTube Data API v3** aktivieren.
3. Unter **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel** einen Schlüssel erzeugen.
4. Den Schlüssel einschränken: **Websites** mit `https://janschwob.github.io/*` und **API-Einschränkung** nur auf die YouTube Data API v3.
5. Den Schlüssel in der App unter **Einstellungen → YouTube → API-Schlüssel** eintragen.

Der Schlüssel liegt nur auf dem Tablet und nicht im Repository. Das Design-Handoff empfiehlt einen kleinen Server-Proxy; weil GitHub Pages keinen Server hat, ersetzt die Website-Einschränkung aus Schritt 4 diesen Schutz. Eine Suche kostet 101 Einheiten des Tageskontingents von 10 000, also rund 99 Suchen pro Tag.

## Lokal testen

Die YouTube IFrame API funktioniert nicht über `file://`, deshalb braucht es einen kleinen Webserver:

```bash
cd Live-Stream
python3 -m http.server 8000
```

Dann im Browser `http://localhost:8000` öffnen.

Auf einem Tablet im selben WLAN geht auch `http://<IP-des-Macs>:8000`. Wake Lock und die Installation als App funktionieren aber nur über HTTPS, also erst nach dem Deployment.

Mit `?debug=1` an der Adresse (z. B. `https://janschwob.github.io/Livestream-Bilderrahmen/?debug=1`) zeigt die App oben links ein Protokoll der Player-Ereignisse (Status, Fehlercodes). Das hilft vor allem auf dem iPad, wo es keine Konsole gibt.

Für die Fehlersuche gibt es in der Browser-Konsole das Objekt `fenster` (z. B. `fenster.current`, `fenster.status`, `fenster.player.getPlayerState()`).

## Deployment auf GitHub Pages

1. Auf GitHub ein neues Repository anlegen (z. B. `fenster`), öffentlich.
2. Den Inhalt dieses Ordners hochladen (per Web-Upload oder `git push`). `index.html` muss im Wurzelverzeichnis liegen.
3. Im Repository unter **Settings → Pages** als Quelle **Deploy from a branch**, Branch `main`, Ordner `/ (root)` wählen und speichern.
4. Nach ein bis zwei Minuten läuft die App unter `https://<benutzername>.github.io/fenster/`.

Code-Änderungen sind nach dem Push innerhalb weniger Minuten live. Damit Safari keine alten Dateien aus dem Cache nimmt, hängt `index.html` eine Versionsnummer an `styles.css` und `app.js` (`?v=6`). Diese Nummer bei jeder Änderung erhöhen.

## Einrichtung iPad

1. Die GitHub-Pages-Adresse in **Safari** öffnen.
2. **Teilen → Zum Home-Bildschirm**. Die App erscheint als „Fenster“ und startet danach randlos im Vollbild, ohne Safari-Leisten.
3. **Einstellungen → Anzeige & Helligkeit → Automatische Sperre → Nie.**
4. **Geführter Zugriff** aktivieren, damit niemand die App versehentlich verlässt:
   - **Einstellungen → Bedienungshilfen → Geführter Zugriff** einschalten und einen Code festlegen.
   - Im selben Menü **Automatische Sperre** auf **Nie** stellen.
   - Die App öffnen, dreimal die obere Taste (bzw. Home-Taste) drücken, **Starten** antippen. Berührungen eingeschaltet lassen, sonst funktioniert das Overlay nicht.
5. iPad in Querformat einsetzen und am Netzteil lassen. Unter **Einstellungen → Akku → Akkuzustand** „Optimiertes Laden“ eingeschaltet lassen.

Einschränkungen auf dem iPad:
- Im **Stromsparmodus** startet Safari keine Videos von selbst, auch nicht stumm. Die App zeigt dann „Auf das Bild tippen zum Starten“ und lässt den Tap direkt zum YouTube-Player durch. Der untere Bildstreifen öffnet weiterhin das Overlay. Für den Dauerbetrieb den Stromsparmodus ausgeschaltet lassen.
- Die Lautstärke regelt man mit den Hardwaretasten.
- Nach dem täglichen Reload um 04:00 Uhr läuft der Stream weiter, aber stumm, bis jemand einmal tippt (Vorgabe von Safari).

## Einrichtung Android (Redmi Pad 2, Galaxy Tab A11+)

### Variante A: Chrome als installierte App

1. Die Adresse in **Chrome** öffnen, im Menü **App installieren** bzw. **Zum Startbildschirm hinzufügen** wählen.
2. Die App vom Startbildschirm starten. Sie läuft im Vollbild; falls nicht, fordert sie beim ersten Tap selbst Vollbild an.
3. **Einstellungen → Anzeige → Bildschirm-Timeout** auf den Maximalwert stellen. Die App hält den Bildschirm zusätzlich per Wake Lock wach.

### Variante B: Fully Kiosk Browser (empfohlen für 24/7)

Fully Kiosk aus dem Play Store installieren. Einige Funktionen (Kiosk-Modus, Zeitplan) brauchen die Plus-Lizenz. Empfohlene Einstellungen:

| Bereich | Einstellung | Wert |
|---|---|---|
| Web Content Settings | **Start URL** | `https://<benutzername>.github.io/fenster/?autosound=1` |
| Web Content Settings | **Autoplay Videos** | an |
| Web Content Settings | **Enable JavaScript Interface** | aus (nicht nötig) |
| Device Management | **Keep Screen On** | an |
| Device Management | **Launch on Boot** | an |
| Device Management | **Screen Orientation** | Landscape |
| Toolbars & Appearance | **Fullscreen Mode**, Statusleiste und Navigationsleiste ausblenden | an |
| Toolbars & Appearance | Address Bar, Tabs, Pull to Refresh | aus |
| Kiosk Mode (Plus) | **Enable Kiosk Mode** + PIN | an |
| Screensaver | **Screensaver Timer** | 0 (aus) |
| Power Settings (optional, Plus) | **Schedule Wakeup / Sleep** | z. B. Bildschirm 23:00–07:00 aus |
| Web Auto Reload | **Reload on Internet Reconnect** | aus lassen – macht die App selbst |

Der Parameter `?autosound=1` ist für Fully Kiosk gedacht: Ist „Autoplay Videos“ erlaubt, startet die App auch nach einem Neustart oder dem nächtlichen Reload ohne Tap mit Ton. Lässt der Browser es doch nicht zu, fällt sie automatisch auf stumm zurück. In Chrome und Safari bringt der Parameter nichts.

### Akku und Stromsparfunktionen

- **Samsung Galaxy Tab A11+:** **Einstellungen → Akku → Akkuschutz** einschalten. Je nach One-UI-Version heisst die Stufe „Ladung auf 85 % begrenzen“ (ältere Versionen) oder **Maximum** (begrenzt auf 80 %). Ausserdem unter **Akku → Grenzwerte für Hintergrundnutzung** den Browser bzw. Fully Kiosk zu den **Nie in Standby versetzten Apps** hinzufügen.
- **Xiaomi Redmi Pad 2:** In den App-Infos von Fully Kiosk bzw. Chrome **Autostart** erlauben und **Akkusparmodus → Keine Einschränkungen** setzen. Gibt es unter **Akku** eine Ladeschutz-Option („Intelligentes Laden“ o. ä.), diese einschalten.

## Streams hinzufügen oder ändern

Im Normalfall direkt in der App über **Meine Fenster → Neues Fenster**. `streams.json` enthält nur die Startliste für den allerersten Start und für „Startliste wiederherstellen“; die ersten drei Einträge sind die Standard-Favoriten.

```json
{ "id": "ydYDqZQpim8", "title": "Wasserloch in der Namib", "location": "Namib-Naukluft, Namibia" }
```

| Feld | Bedeutung |
|---|---|
| `id` | YouTube-Video-ID, die 11 Zeichen nach `watch?v=` |
| `title` | Titel im Bildschild |
| `location` | Ort, wird in Grossbuchstaben unter dem Titel gezeigt |

So prüft man vorher, ob ein Stream einbettbar ist: `https://www.youtube.com/embed/<id>` im Browser öffnen. Erscheint „Video nicht verfügbar“ oder „Wiedergabe auf anderen Websites deaktiviert“, funktioniert er in der App nicht.

## Zuverlässigkeit im Dauerbetrieb

- **Gesperrte oder offline Streams:** Bei einem YouTube-Fehler oder einem beendeten Stream erscheint oben „Dieser Ort ist gerade nicht live“, und die App wechselt sofort zum nächsten funktionierenden Ort: erst die Favoriten, dann die übrigen. Bleibt ein Stream länger als 20 s beim Laden hängen, gilt er ebenfalls als offline.
- **Hänger:** Alle 30 s prüft die App, ob das Video läuft und die Zeit fortschreitet. Nach zwei Fehlschlägen in Folge lädt sie den Stream neu, nach drei erfolglosen Neuladeversuchen wechselt sie zum nächsten.
- **Rückkehr zum gewählten Stream:** Läuft wegen einer Störung ein Ersatz-Stream, versucht die App stündlich wieder den gewählten Stream.
- **Alle Streams gestört:** dezenter Hinweis, neuer Versuch alle 2 Minuten.
- **Netzwerk:** Ohne Internet erscheint oben „Keine Internetverbindung“; sobald das Netz zurück ist, lädt der Stream neu.
- **Täglicher Reload** um 04:00 Uhr Gerätezeit gegen Speicherlecks. Er findet nur statt, wenn die Seite erreichbar ist, damit nie eine Fehlerseite stehen bleibt.
- **Wake Lock** hält den Bildschirm an, wo der Browser es unterstützt (Chrome, Safari ab iPadOS 16.4).
- Beim Laden und Wechseln zeigt die App das weichgezeichnete Live-Vorschaubild, bis YouTube seine kurz eingeblendeten Titel und Bedienelemente wieder ausgeblendet hat.

### Kanal-Fallback: nicht umgesetzt

Die Spezifikation sah vor, bei einem gescheiterten Stream `https://www.youtube.com/embed/live_stream?channel=<channelId>` zu versuchen. Getestet am 25.10.2026 mit den Kanälen NamibiaCam, EarthCam und Luxury Island: YouTube antwortet über die IFrame API jedes Mal mit **Fehler 150**, und das direkt eingebettete IFrame zeigt „Dieses Video ist nicht verfügbar“. Dieser Weg funktioniert derzeit nicht mehr, deshalb ist das Feature weggelassen. `channelId` bleibt in `streams.json`, damit man bei einer neuen Video-ID schnell den Kanal findet. Ändert ein 24/7-Stream seine ID, muss `videoId` von Hand aktualisiert werden. Bis dahin springt die App automatisch auf den nächsten Stream.

## Testbericht

Getestet am 25.10.2026 lokal (`python3 -m http.server`) in Chromium 152 über die YouTube IFrame API mit den Player-Parametern der App.

| videoId | Stream | Kanal | Einbettbar | Live | Start bis Wiedergabe |
|---|---|---|---|---|---|
| ydYDqZQpim8 | Wasserloch Namib-Wüste, Namibia | NamibiaCam | ja | ja | 0,7 s |
| AeMUdOPFcXI | Okaukuejo-Wasserloch, Etosha, Namibia | NamibiaCam | ja | ja | 0,6 s |
| XsOU8JnEpNM | Ol Donyo Lodge, Chyulu Hills, Kenia | Africam | ja | ja | 0,7 s |
| Thtj8Ht7Z_c | Wilder Strand, Seychellen | Luxury Island | ja | ja | 0,7 s |
| mt7uE-n0YPI | Venedig, Ponte delle Guglie, Italien | I Love You Venice | ja | ja | 1,1 s |
| gzgrofStPJ0 | Venedig, Dorsoduro, Italien | I Love You Venice | ja | ja | 0,8 s |
| MW3fisTCXRQ | Strand Koh Phangan, Thailand | Teleport.camera | ja | ja | 0,6 s |
| 5uZa3-RMFos | Hafen von Sydney, Australien | WebcamSydney | ja | ja | 0,8 s |
| 3nyPER2kzqk | Dublin, Temple Bar, Irland | EarthCam | ja | ja | 0,8 s |

**Ergebnis: Alle 9 Teststreams sind einbettbar und waren zum Testzeitpunkt live.** Titel und Kanäle der zuvor unbekannten Streams wurden über oEmbed bzw. die Videoseite ermittelt.

Ausserdem geprüft:
- Autostart stumm im Vollbild ohne YouTube-Bedienelemente, Cover-Zuschnitt im Quer- und Hochformat ohne schwarze Balken.
- Overlay öffnet per Tap und schliesst nach 6 s.
- Streamwechsel ohne Seitenreload, Ton bleibt beim Wechsel an.
- Gewählter Stream und Toneinstellung überstehen einen Reload. Der Ton kommt mit dem ersten Tap zurück.
- Ein absichtlich kaputter Stream wird als „nicht verfügbar“ markiert, die App wechselt automatisch zum nächsten.

Noch auf echter Hardware zu prüfen: Ton per Tap in iPadOS Safari, Fully Kiosk auf Redmi Pad 2 und Galaxy Tab A11+, 24-Stunden-Dauerlauf. Die Logik dafür ist umgesetzt, auf den Geräten aber nicht getestet.

### Test der Version 1b (28.10.2026)

Lokal in Chromium bei 1194 × 834 (iPad-Referenz) und 1280 × 800 (Android-Tablet) geprüft:
- Passepartout Creme/Mittel als Standard, Wechsel auf Anthrazit/Breit wirkt sofort auf Stream und Vorschau. Das Video füllt den Ausschnitt ohne schwarze Balken.
- Overlay mit Vignette, Favoriten-Leiste und Bildschild. Favorit antippen wechselt den Stream, der Ton-Knopf schaltet den Ton ein (Salbei-Hintergrund).
- „Meine Fenster“ mit 9 Orten und 3 Favoriten, Stern-Umschaltung, Einstellungen mit allen Optionen.
- Neues Fenster per YouTube-Link: Titel und Kanal kommen über oEmbed, „+“ fügt den Ort hinzu, danach steht „✓“. Gelöschte Videos ergeben „Video nicht gefunden“.
- Ein absichtlich kaputter Stream zeigt „Dieser Ort ist gerade nicht live“ und wechselt automatisch zum nächsten Ort.

Nicht getestet: die Suche über die YouTube Data API (dafür fehlt ein API-Schlüssel) und die neue Version auf dem iPad.
