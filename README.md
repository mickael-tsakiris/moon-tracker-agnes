# Moon Tracker Agnes — v35

## Projet
PWA pour Agnes (femme de Mickael). Localise la Lune en temps reel avec des reperes physiques de l'environnement immediat (rues, commerces, monuments a 50-200m), PAS des coordonnees.

**URL** : https://mickael-tsakiris.github.io/moon-tracker-agnes/
**Repo** : github.com/mickael-tsakiris/moon-tracker-agnes

## Stack
HTML/CSS/JS vanilla, Astronomy Engine, Overpass API, Nominatim, Open-Meteo, DeviceOrientation, getUserMedia

## Architecture
- `index.html` — structure de l'app, 4 onglets (LUNE, CAMERA, DETAILS, A PROPOS)
- `style.css` — design system complet (variables, glassmorphism, responsive)
- `app.js` — logique (~1890 lignes), sections :
  - INIT : geoloc, moon calc, sky, weather fetch
  - GEOLOCATION : position reelle ou fallback Paris 17e
  - MOON CALCULATIONS : Astronomy Engine, phase, illumination, azimut, altitude
  - LANDMARKS : Nominatim + Overpass, rues et commerces a 50-200m
  - WEATHER TEXT : traduction WMO codes en francais (getWeatherText)
  - DESCRIPTION ENGINE : texte contextuel lune + meteo + reperes physiques
  - COMPASS : boussole interactive avec heading device
  - RENDERING : lune (NASA photo + SVG blur terminateur), boussole, visibilite
  - SKY BACKGROUND : gradient CSS 5 stops, presets par condition meteo, jour/nuit
  - WEATHER EFFECTS : particules canvas (pluie, neige, grele) par WMO code
  - NAVIGATION : onglets, ecrans
  - UTILITIES : formatage, helpers
  - AR CAMERA : overlay camera avec tracking lune
- `moon-texture.jpg` — photo pleine lune NASA/Wikipedia (512x512, public domain)
- `manifest.json` — PWA manifest
- `sw.js` — service worker, network-first, cache v35
- `favicon.svg` — icone lune

## Decisions techniques validees (v35)

### Rendu lune
- Image de base = pleine lune 100% eclairee, fond noir, public domain
- Terminateur = masque alpha avec SVG feGaussianBlur (stdDeviation=40)
- canvas.filter = 'blur()' NE FONCTIONNE PAS sur Safari iOS → SVG filter obligatoire
- Face sombre = transparente (destination-out), ciel visible a travers
- Tint jour = rgba(230,235,245,0.15) pour blanchir la lune en journee
- Glow uniquement cote eclaire, via destination-over
- Tilt attenue a 35% de la valeur astronomique (lisibilite)

### Ciel
- CSS gradient 5 stops, pilote par Astronomy.Horizon() (altitude soleil)
- Transition CONTINUE soleil → crepuscule → nuit (pas de tranches horaires)
- SKY_PRESETS par condition meteo WMO : clair, partiellement nuageux, couvert, brouillard, bruine, pluie, forte pluie, neige, orage
- Chaque preset a une variante jour ET nuit
- Etoiles en CSS (radial-gradient box-shadow), opacite pilotee par altitude soleil + meteo

### Meteo
- API Open-Meteo : weather_code, cloud_cover, precipitation, snowfall, wind_speed, is_day
- WMO weather_code traduit en francais par getWeatherText() : 20+ conditions
- Badge de visibilite contextuel (conditions ideales / peu visible / etc.)
- Animations particules canvas : pluie (4 intensites), neige (3), grele (2)
- Weather canvas en position fixed z-9999, HORS de #sky-bg (sinon invisible sous #app)

### Landmarks
- Recherche progressive : 150m → 350m → 600m
- Priorite rues + commerces (boulangerie, pharmacie, cafe)
- Jamais de "direction sud-est" — uniquement reperes physiques
- Second repere d'orientation quand possible

### AR Camera
- Pitch = beta - 90, smoothing sur heading et pitch
- Overlay canvas avec fleche directionnelle vers la lune

## Dev local
```
cd ~/Documents/moon-tracker-agnes
python3 -m http.server 3456
```
Ouvrir http://localhost:3456

## Deploy
```
git push  # GitHub Pages deploie automatiquement (~2 min)
```

## Tunnel HTTPS temp (pour tester sur iPhone)
```
npx cloudflared tunnel --url http://localhost:3456
```

## Process
- Bumper CACHE_NAME dans sw.js ET les query params dans index.html a CHAQUE deploy
- Tester visuellement avant push
- Envoyer un message a Agnes (WhatsApp/mail) 10 min apres chaque deploy majeur
