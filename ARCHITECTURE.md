# Architecture — Moon Tracker Agnes (v37)

## Vue d'ensemble

PWA single-page, vanilla JS (zero framework), deployee sur GitHub Pages.
L'app localise la Lune en temps reel et guide l'utilisateur avec des
reperes physiques de son environnement immediat.

Push notifications via Cloudflare Worker : alerte le soir si la lune est visible.

## Fichiers

```
moon-tracker-agnes/
  index.html            # Structure HTML, 4 onglets, SVG inline (terminatorBlur)
  style.css             # Design system complet (variables, glassmorphism, responsive)
  app.js                # Logique unique (~2100 lignes)
  moon-texture.jpg      # Photo pleine lune NASA/Wikipedia 512x512
  sw.js                 # Service worker: network-first cache + push + notificationclick
  manifest.json         # PWA manifest (start_url: "./", scope: "./")
  favicon.svg           # Icone lune SVG (navigateur)
  apple-touch-icon.png  # Icone 180x180 (ecran d'accueil iOS, generee depuis moon-texture.jpg)
  icon-192.png          # Icone manifest 192x192
  icon-512.png          # Icone manifest 512x512 + maskable
  worker/               # Cloudflare Worker — push notifications
    index.js            # Calcul lune + meteo + generation message + envoi push
    landmarks.js        # Reperes physiques autour du 33 Boissy d'Anglas
    wrangler.toml       # Config Cloudflare (cron triggers, KV binding)
    package.json        # Dependencies (astronomy-engine)
  .claude/              # Config Claude Code (launch.json, settings, CLAUDE.md)
```

## Flux de donnees

```
1. INIT
   Service Worker register() → DOMContentLoaded
   Geolocalisation (ou fallback Paris 48.8566, 2.3522)
        |
        v
2. CALCULS PARALLELES
   +-- Astronomy Engine → position lune (azimut, altitude, phase, illumination)
   +-- Astronomy.Horizon() → altitude soleil (pour ciel + teinte lune)
   +-- Nominatim reverse → quartier + ville
   +-- Overpass API → landmarks physiques (rues, commerces) 150-600m
   +-- Open-Meteo → weather_code, cloud_cover, precipitation, snowfall
        |
        v
3. RENDU
   +-- updateSky()          → gradient CSS 5 stops (presets par meteo + altitude soleil)
   +-- renderMoonPhase()    → canvas : photo NASA + masque alpha + SVG blur terminateur
   +-- generateDescription()→ texte contextuel (reperes physiques + meteo)
   +-- renderVisibility()   → badge conditions (WMO code)
   +-- updateWeatherEffects()→ particules canvas (pluie/neige/grele)
   +-- renderCompass()      → boussole SVG avec direction lune
        |
        v
4. BOUCLE LIVE
   +-- DeviceOrientation → heading boussole + AR tracking
   +-- setInterval 60s   → recalcul lune + re-fetch meteo
        |
        v
5. PUSH NOTIFICATIONS (apres 3s, si pas deja abonne)
   +-- showNotificationBanner() → bandeau "Activer" (geste utilisateur)
   +-- subscribeToPush() → PushManager.subscribe + envoi au Worker
```

## Push Notifications — Architecture

```
iPhone Agnes (PWA standalone)
   |
   | 1. subscribeToPush() → PushManager.subscribe(VAPID key)
   |    → POST /subscribe (subscription JSON)
   v
Cloudflare Worker (moon-push.mickael-tsakiris.workers.dev)
   |
   | KV "PUSH_SUBS" : stocke les subscriptions (endpoint + keys)
   |
   | 2. Cron 17h + 18h UTC (couvre CET/CEST)
   |    → calculateMoon(48.8688, 2.3208) — Astronomy Engine
   |    → fetchWeather() — Open-Meteo
   |    → checkVisibility() :
   |       - altitude > 5° ?
   |       - couverture nuageuse < 70% ?
   |       - illumination > 5% ?
   |       - precipitations < 1mm/h ?
   |    → Si visible : generateMessage() + sendPush()
   v
Apple Push Service (web.push.apple.com)
   → Notification sur iPhone Agnes
```

### Message push — contextualisation

Le message est formule comme si on parle a Agnes a la porte du 33 :
- Direction relative : droite/gauche par rapport a la sortie (face est)
- Hauteur : "bien en hauteur", "a mi-hauteur", "assez bas"
- Repere visible : "vers la Concorde", "en remontant vers le Fg St-Honore"
- Warning immeubles si altitude < 10°

Exemple : "Agnes ! En sortant du Retiro, regarde bien en hauteur sur ta droite, en descendant la rue, vers la Concorde. Premier croissant, peu nuageux."

### Raccourci iOS (geofencing)

En complement du push cron : automatisation iOS native.
- App Raccourcis > Automatisation > Quitter [33 rue Boissy d'Anglas]
- Action : ouvrir Moon Tracker (raccourci ecran d'accueil)
- Se declenche a toute heure, quand Agnes quitte physiquement le perimetre
- Zero impact batterie cote app (geofencing par iOS)

## APIs externes

| API | Usage | Endpoint |
|-----|-------|----------|
| Astronomy Engine | Position lune/soleil, phases | JS lib locale (CDN) |
| Open-Meteo | Meteo temps reel (WMO code, nuages, precipitation) | api.open-meteo.com/v1/forecast |
| Nominatim | Reverse geocoding (quartier, ville) | nominatim.openstreetmap.org/reverse |
| Overpass | Landmarks physiques (rues, commerces, POI) | overpass-api.de/api/interpreter |
| Cloudflare Workers | Push notifications backend | moon-push.mickael-tsakiris.workers.dev |
| Cloudflare KV | Stockage subscriptions push | namespace 47a3ae3a17ff47598e44be69b72239af |
| Apple Push Service | Delivery notifications iOS | web.push.apple.com |

## Rendu lune — pipeline canvas

```
1. Charger moon-texture.jpg (pleine lune 100%)
2. Creer canvas offscreen (220x220 CSS, *dpr pour retina)
3. Dessiner photo en oversize (pad=18px) pour que le fond noir tombe hors clip
4. Creer canvas masque :
   a. Dessiner la zone eclairee en blanc (arc + ellipse)
   b. Appliquer SVG feGaussianBlur (stdDeviation=40) via mc.filter
   c. IMPORTANT : canvas.filter='blur()' ne fonctionne PAS sur iOS Safari
5. Appliquer le masque en destination-in → seule la partie eclairee reste
6. Ajouter glow cote eclaire (destination-over)
7. Appliquer tint jour si altitude soleil > 0
8. Dessiner sur le canvas principal avec rotation (tilt 35%)
```

## Ciel — systeme de presets

Chaque condition meteo WMO a un preset jour ET nuit (5 couleurs gradient).
L'interpolation entre jour/nuit est pilotee par l'altitude du soleil :
- sunAlt > 20° → preset jour
- 6° < sunAlt < 20° → lerp low sun → jour
- 0° < sunAlt < 6° → lerp civil twilight → low sun
- -6° < sunAlt < 0° → lerp nuit → civil twilight
- -12° < sunAlt < -6° → lerp nuit → nautical
- sunAlt < -12° → preset nuit

Transition continue, pas de tranches horaires. La saison est automatiquement
prise en compte car le calcul utilise Astronomy.Horizon('Sun') reel.

## Effets meteo — particules canvas

Le canvas meteo est en `position: fixed; z-index: 9999` HORS de #sky-bg
(sinon invisible sous #app). Particules generees par WMO weather_code :
- Pluie : 4 intensites (bruine 40p, legere 80p, moderee 150p, forte 250p)
- Neige : 3 intensites (legere 50p, moderee 100p, forte 180p)
- Grele : 2 intensites (legere 30p, forte 60p)

## AR Camera — fleches directionnelles

Quand la lune est hors ecran, une fleche double chevron doree (32px)
avec glow et pulse subtil pointe vers la direction de la lune.
- Angle : `atan2(moonY - center, moonX - center)`, rotation `angle - PI/2`
- Positionnee le long du vecteur de direction depuis le centre
- Label "LUNE" sous la fleche

## Contraintes iOS Safari

- `canvas.filter = 'blur()'` est accepte silencieusement mais NE FAIT RIEN
- Solution : SVG feGaussianBlur defini dans index.html, reference via `url(#terminatorBlur)`
- DeviceOrientationEvent.requestPermission() requis pour la boussole/AR
- getUserMedia necessite HTTPS (tunnel cloudflared pour dev)
- Service worker : bumper CACHE_NAME a chaque deploy pour forcer le refresh
- **Push** : PushManager disponible UNIQUEMENT en mode standalone (ecran d'accueil)
- **Push** : Notification.requestPermission() DOIT etre dans un handler de click
- **Push** : SW register() DOIT etre dans DOMContentLoaded AVANT tout usage push
- **Push** : VAPID key → utiliser urlBase64ToUint8Array(), jamais atob() direct
- **Cache standalone** : tres collant. Purger via Reglages > Safari > Donnees de sites

## Conventions

- Versioning : v{major} dans sw.js, style.css?v={n}, app.js?v={n} — toujours synchronises
- Sections app.js : headers `// ==== SECTION NAME ====`
- State global : objet `state` (position, lune, meteo, landmarks, UI)
- Selecteur DOM : `$(id)` alias de `document.getElementById`
- Nav bar : --nav-h: 76px, box-sizing: border-box, padding safe-area
- Pas de framework, pas de bundler, pas de transpileur
