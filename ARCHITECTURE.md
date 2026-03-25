# Architecture — Moon Tracker Agnes

## Vue d'ensemble

PWA single-page, vanilla JS (zero framework), deployee sur GitHub Pages.
L'app localise la Lune en temps reel et guide l'utilisateur avec des
reperes physiques de son environnement immediat.

## Fichiers

```
moon-tracker-agnes/
  index.html          # Structure HTML, 4 onglets, SVG inline (terminatorBlur)
  style.css           # Design system complet (variables, glassmorphism, responsive)
  app.js              # Logique unique (~1890 lignes)
  moon-texture.jpg    # Photo pleine lune NASA/Wikipedia 512x512
  sw.js               # Service worker network-first, cache versionne
  manifest.json       # PWA manifest (nom, icones, theme)
  favicon.svg         # Icone lune SVG
  .claude/            # Config Claude Code (launch.json, settings)
```

## Flux de donnees

```
1. INIT
   Geolocalisation (ou fallback Paris 17e 48.8835, 2.3219)
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
```

## APIs externes

| API | Usage | Endpoint |
|-----|-------|----------|
| Astronomy Engine | Position lune/soleil, phases | JS lib locale (CDN) |
| Open-Meteo | Meteo temps reel (WMO code, nuages, precipitation) | api.open-meteo.com/v1/forecast |
| Nominatim | Reverse geocoding (quartier, ville) | nominatim.openstreetmap.org/reverse |
| Overpass | Landmarks physiques (rues, commerces, POI) | overpass-api.de/api/interpreter |

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

## Effets meteo — particules canvas

Le canvas meteo est en `position: fixed; z-index: 9999` HORS de #sky-bg
(sinon invisible sous #app). Particules generees par WMO weather_code :
- Pluie : 4 intensites (bruine 40p, legere 80p, moderee 150p, forte 250p)
- Neige : 3 intensites (legere 50p, moderee 100p, forte 180p)
- Grele : 2 intensites (legere 30p, forte 60p)

## Contraintes iOS Safari

- `canvas.filter = 'blur()'` est accepte silencieusement mais NE FAIT RIEN
- Solution : SVG feGaussianBlur defini dans index.html, reference via `url(#terminatorBlur)`
- DeviceOrientationEvent.requestPermission() requis pour la boussole/AR
- getUserMedia necessite HTTPS (tunnel cloudflared pour dev)
- Service worker : bumper CACHE_NAME a chaque deploy pour forcer le refresh

## Conventions

- Versioning : v{major} dans sw.js, style.css?v={n}, app.js?v={n} — toujours synchronises
- Sections app.js : headers `// ==== SECTION NAME ====`
- State global : objet `state` (position, lune, meteo, landmarks, UI)
- Selecteur DOM : `$(id)` alias de `document.getElementById`
- Pas de framework, pas de bundler, pas de transpileur
