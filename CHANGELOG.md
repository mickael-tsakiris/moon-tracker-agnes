# Changelog — Moon Tracker Agnes

## v35 (2025-03-25) — Weather + Code cleanup

### Meteo temps reel
- Descriptions meteo basees sur les codes WMO (20+ conditions en francais)
- Animations particules canvas : pluie (4 intensites), neige (3), grele (2)
- Badge de visibilite contextuel selon les conditions reelles
- Ciel CSS reactive a TOUTES les conditions WMO (presets jour + nuit)
- Plus jamais de "Ciel couvert" generique quand il pleut

### Rendu lune
- Terminateur adouci via SVG feGaussianBlur (seule methode fiable sur iOS Safari)
- Lune blanchie en journee (tint rgba)

### Nettoyage code
- Suppression dead code (fonctions legacy, variables inutilisees)
- Fix CSS invalide (composes → CSS standard)
- Suppression monkey-patch switchTab (integre proprement)
- Suppression fichiers orphelins (cloud1.png, moon-texture-old.jpg)
- Versions synchronisees partout (sw.js, CSS, JS = v35)
- README reecrit avec architecture complete

---

## v32-v34 (2025-03-25) — Sky + Blur iterations

### Ciel
- Passage du canvas procedural au CSS gradient 5 stops
- Presets meteo par condition WMO (clair, couvert, pluie, neige, orage, brouillard)
- Transition continue jour/crepuscule/nuit via altitude soleil (Astronomy.Horizon)
- Etoiles CSS, opacite pilotee par altitude soleil + couverture nuageuse
- Tentatives nuages CSS (toutes echouees — a reprendre)

### Blur terminateur
- v32 : canvas.filter('blur') → fonctionne desktop, ignore sur iOS
- v33 : box blur manuel alpha → insuffisant visuellement
- v34 : SVG feGaussianBlur → solution definitive cross-browser

---

## v31 (2025-03-24) — Atmospheric moon

- Blur atmospherique 1.2px sur la lune
- Teinte horaire : doree la nuit, pale le jour
- Photo NASA SVS 2024 comme base

---

## v30 (2025-03-24) — Transparent dark side

- Face sombre transparente (destination-out) — le ciel passe a travers
- Photo NASA SVS pleine lune comme base
- Recherche progressive landmarks 150m → 350m → 600m
- Contour earthshine subtil

---

## v29 (2025-03-24) — CSS sky, offscreen rendering

- Rendu lune 100% offscreen (plus d'artefacts clip)
- Ombre cote sombre = couleur du ciel
- Ciel CSS (remplacement du canvas procedural)
- Nettoyage 231 lignes de dead code
- Landmarks rayon 150m

---

## v28 et precedentes — Fondations

- Architecture PWA (manifest, service worker, 4 onglets)
- Astronomy Engine pour calculs lunaires
- AR camera avec DeviceOrientation
- Boussole interactive
- Landmarks via Nominatim + Overpass API
- Geolocalisation avec fallback Paris 17e
