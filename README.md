# Fenster – Livestream-Bilderrahmen

Schlanke Web-App, die 24/7 auf einem Tablet im Bilderrahmen läuft und einen YouTube-Livestream randlos im Vollbild zeigt. Ein Tap blendet die Bedienung ein: Streams wechseln, Ton ein/aus, Lautstärke.

Läuft auf iPad (Safari, Home-Bildschirm) und Android (Chrome als installierte App oder Fully Kiosk Browser). Reines HTML/CSS/JavaScript, kein Build-Schritt, kein Backend.

| Datei | Inhalt |
|---|---|
| `index.html` | Seitengerüst |
| `styles.css` | Gestaltung (dunkel, Systemschrift, skaliert mit der Bildschirmgrösse) |
| `app.js` | Player, Overlay, Ton, Fehlerbehandlung, Wake Lock, täglicher Reload |
| `streams.json` | Liste der Livestreams – nur hier werden Streams gepflegt |
| `manifest.webmanifest`, `icons/` | Home-Bildschirm-App (PWA) |

## Bedienung

- **Ruhezustand:** Stream randlos, ohne YouTube-Bedienelemente. Startet immer stumm.
- **Tap irgendwo:** Overlay blendet ein. Oben links Name und Ortszeit, oben rechts der Ton-Schalter (auf Android zusätzlich ein Lautstärkeregler), unten die Kachelreihe aller Streams.
- Das Overlay schliesst nach 6 Sekunden ohne Bedienung, oder sofort mit einem Tap neben die Bedienelemente.
- **Kachel antippen:** wechselt den Stream ohne Neuladen der Seite. Der Tonzustand bleibt erhalten.
- Gewählter Stream, Ton an/aus und Lautstärke werden gespeichert und nach einem Neustart wiederhergestellt. Der Ton kommt erst mit dem ersten Tap zurück, weil Browser Autoplay nur stumm erlauben. Verweigert der Browser den Ton, erscheint im Overlay „Tippen für Ton“.

## Lokal testen

Die YouTube IFrame API funktioniert nicht über `file://`, deshalb braucht es einen kleinen Webserver:

```bash
cd Live-Stream
python3 -m http.server 8000
```

Dann im Browser `http://localhost:8000` öffnen.

Auf einem Tablet im selben WLAN geht auch `http://<IP-des-Macs>:8000`. Wake Lock und die Installation als App funktionieren aber nur über HTTPS, also erst nach dem Deployment.

Für die Fehlersuche gibt es in der Browser-Konsole das Objekt `fenster` (z. B. `fenster.current`, `fenster.status`, `fenster.player.getPlayerState()`).

## Deployment auf GitHub Pages

1. Auf GitHub ein neues Repository anlegen (z. B. `fenster`), öffentlich.
2. Den Inhalt dieses Ordners hochladen (per Web-Upload oder `git push`). `index.html` muss im Wurzelverzeichnis liegen.
3. Im Repository unter **Settings → Pages** als Quelle **Deploy from a branch**, Branch `main`, Ordner `/ (root)` wählen und speichern.
4. Nach ein bis zwei Minuten läuft die App unter `https://<benutzername>.github.io/fenster/`.

Änderungen an `streams.json` sind nach dem Push innerhalb weniger Minuten live. Die Tablets übernehmen sie spätestens beim täglichen Reload um 04:00 Uhr.

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
- iPadOS lässt die Lautstärke nicht per Webseite steuern. Der Lautstärkeregler ist deshalb ausgeblendet; die Lautstärke regelt man mit den Hardwaretasten.
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

Der Parameter `?autosound=1` ist für Fully Kiosk gedacht: Ist „Autoplay Videos“ erlaubt, stellt die App den gespeicherten Ton auch nach einem Neustart oder dem nächtlichen Reload ohne Tap wieder her. Lässt der Browser es doch nicht zu, fällt sie automatisch auf stumm zurück und zeigt „Tippen für Ton“. In Chrome und Safari bringt der Parameter nichts.

### Akku und Stromsparfunktionen

- **Samsung Galaxy Tab A11+:** **Einstellungen → Akku → Akkuschutz** einschalten. Je nach One-UI-Version heisst die Stufe „Ladung auf 85 % begrenzen“ (ältere Versionen) oder **Maximum** (begrenzt auf 80 %). Ausserdem unter **Akku → Grenzwerte für Hintergrundnutzung** den Browser bzw. Fully Kiosk zu den **Nie in Standby versetzten Apps** hinzufügen.
- **Xiaomi Redmi Pad 2:** In den App-Infos von Fully Kiosk bzw. Chrome **Autostart** erlauben und **Akkusparmodus → Keine Einschränkungen** setzen. Gibt es unter **Akku** eine Ladeschutz-Option („Intelligentes Laden“ o. ä.), diese einschalten.

## Streams hinzufügen oder ändern

Streams stehen ausschliesslich in `streams.json`. Die Reihenfolge der Datei ist die Reihenfolge der Kacheln, der erste Eintrag ist der Standard beim allerersten Start.

```json
{
  "id": "namib-desert",
  "name": "Wasserloch Namib-Wüste",
  "country": "Namibia",
  "timezone": "Africa/Windhoek",
  "videoId": "ydYDqZQpim8",
  "channelId": "UC9X6gGKDv2yhMoofoeS7-Gg"
}
```

| Feld | Bedeutung |
|---|---|
| `id` | eindeutiger Kurzname (Kleinbuchstaben, Bindestriche) |
| `name` | Anzeigename |
| `country` | Land, wird neben der Uhrzeit angezeigt |
| `timezone` | IANA-Zeitzone für die Ortszeit, z. B. `Europe/Rome` ([Liste](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)) |
| `videoId` | die 11 Zeichen nach `watch?v=` in der YouTube-Adresse |
| `channelId` | optional, derzeit nur zur Dokumentation (siehe unten) |

So prüft man vorher, ob ein Stream einbettbar ist: `https://www.youtube.com/embed/<videoId>` im Browser öffnen. Erscheint „Video nicht verfügbar“ oder „Wiedergabe auf anderen Websites deaktiviert“, funktioniert er in der App nicht.

## Zuverlässigkeit im Dauerbetrieb

- **Gesperrte oder offline Streams:** YouTube-Fehler 101/150/153 markieren den Stream als „nicht verfügbar“, 2/5/100 sowie ein beendeter Stream als „offline“. Die App wechselt sofort zum nächsten funktionierenden Stream. Startet ein Stream nicht innert 20 s, gilt er ebenfalls als offline.
- **Hänger:** Alle 30 s prüft die App, ob das Video läuft und die Zeit fortschreitet. Nach zwei Fehlschlägen in Folge lädt sie den Stream neu, nach drei erfolglosen Neuladeversuchen wechselt sie zum nächsten.
- **Rückkehr zum gewählten Stream:** Läuft wegen einer Störung ein Ersatz-Stream, versucht die App stündlich wieder den gewählten Stream.
- **Alle Streams gestört:** dezenter Hinweis, neuer Versuch alle 2 Minuten.
- **Netzwerk:** Ohne Internet erscheint unten links „Keine Internetverbindung“; sobald das Netz zurück ist, lädt der Stream neu.
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
