# Moon Tracker Agnes

Application web (PWA) qui indique a Agnes ou se trouve la Lune en temps reel, avec des reperes physiques de son environnement immediat (rues, commerces, monuments) au lieu de coordonnees astronomiques.

**URL de production** : https://mickael-tsakiris.github.io/moon-tracker-agnes/
**Repo** : https://github.com/mickael-tsakiris/moon-tracker-agnes

---

## Architecture

```
moon-tracker-agnes/
├── index.html          # Structure HTML, meta PWA, chargement assets (280 lignes)
├── app.js              # Logique applicative complete (1322 lignes)
├── style.css           # Design system + responsive (743 lignes)
├── manifest.json       # PWA manifest (icone, nom, couleurs)
├── sw.js               # Service Worker (cache offline)
├── package.json        # Dependance : astronomy-engine
└── .gitignore
```

**Zero framework.** HTML/CSS/JS vanilla. Performance maximale, zero build step.

---

## Stack technique

| Composant | Technologie | Role |
|---|---|---|
| Calcul lunaire | [Astronomy Engine](https://github.com/cosinekitty/astronomy) v2.1.19 (CDN) | Position, phase, lever/coucher, illumination |
| Landmarks | [Overpass API](https://overpass-api.de/) (OpenStreetMap) | Commerces, monuments, lieux de culte dans un rayon de 250m |
| Rues | [Nominatim API](https://nominatim.openstreetmap.org/) | Noms de rues dans 12 directions a 100m |
| Meteo | [Open-Meteo API](https://open-meteo.com/) | Couverture nuageuse temps reel |
| Boussole | DeviceOrientationEvent (webkitCompassHeading sur iOS) | Heading du telephone |
| Accelerometre | DeviceOrientationEvent (beta/gamma) | Inclinaison pour vue AR |
| Camera | getUserMedia (facingMode: environment) | Camera arriere pour overlay AR |
| Geolocalisation | navigator.geolocation | Position GPS de l'utilisateur |
| Fond anime | Canvas 2D | Ciel etoile + animation dynamique |

---

## Les 4 onglets

### 1. LUNE (accueil)
- Phase lunaire (visualisation canvas avec ombrage realiste)
- Nom de la phase en francais + pourcentage d'illumination
- Heures de lever/coucher
- **"Ou regarder"** : description en langage naturel avec reperes physiques
  - Priorite 1 : rue alignee avec la Lune + POI proche
  - Priorite 2 : rue seule dans la direction de la Lune
  - Priorite 3 : POI seul
  - Fallback : reference relative avec direction cardinale
- Liste des reperes proches avec indication relative a la Lune
- Couverture nuageuse

### 2. CAMERA (AR)
- Flux camera arriere en plein ecran
- Overlay de la position lunaire (marqueur + cercle de precision)
- Calibration via boussole (heading) + accelerometre (pitch)
- Fleche directionnelle quand la Lune est hors champ
- Texte contextuel : phase + altitude
- Bouton de permission boussole (obligatoire iOS 13+)

### 3. DETAILS
- Altitude, azimut, distance Terre-Lune
- Prochaine pleine Lune (calcul iteratif)
- Constellation traversee (basee sur ecliptique)

### 4. A PROPOS
- Message personnel de Mickael a Agnes

---

## Decisions techniques cles

### Calcul du pitch camera (AR)
Le pitch de la camera = `beta - 90` (PAS `90 - beta`).
- beta=0 (telephone a plat) → camera pointe vers le bas (-90 deg)
- beta=90 (telephone vertical) → camera pointe a l'horizon (0 deg)
- beta=150 (telephone incline vers le haut) → camera pointe vers le haut (+60 deg)

**Bug corrige** : le signe etait inverse, le telephone pointant vers le sol affichait "la Lune est la".

### Smoothing des capteurs
- Heading (boussole) : interpolation circulaire pour eviter les sauts a 0/360 deg
- Pitch : moyenne mobile ponderee (alpha = 0.15)
- Le lissage est crucial sur iOS ou les valeurs brutes sont tres bruitees

### Landmarks : rayon reduit volontairement
- Overpass POI : 250m (pas 2km) — on veut des reperes VISIBLES, pas un musee a 1.5km
- Rues Nominatim : 100m dans 12 directions — environnement immediat
- Les descriptions utilisent toujours un 2e repere d'orientation ("a gauche QUAND TU REGARDES VERS [rue X]")

### Geolocalisation fallback
- Si la geoloc echoue (HTTP, permission refusee) : fallback sur Paris 17e (48.8835, 2.3219)
- Message discret "Position approximative" dans le header

### Cache busting
- Tous les assets charges avec `?v=N` dans index.html
- **Incrementer le numero a chaque modification** sinon le navigateur/SW sert l'ancien code
- Version actuelle : v=13

---

## Design system (etat actuel)

Base sur benchmark Awwwards mars 2026 :
- **Palette** : near-black (#0A0A0F), surfaces semi-transparentes (rgba), gris teintes
- **Typographie** : Geist Sans (Vercel) pour le body, weights ajustes pour dark mode
- **Surfaces** : frosted depth (backdrop-blur + noise grain), pas de glassmorphism lourd
- **Animations** : 150-300ms, easings non-lineaires, GPU-only (transform/opacity)
- **Accent** : warm cream discret pour la Lune uniquement

### Ce qui reste a faire (design)
- [ ] Pousser le design Awwwards-level (polish, micro-interactions, spacing)
- [ ] Fond meteo dynamique anime (nuages, soleil, crepuscule)
- [ ] Animations d'entree etagees sur les cards
- [ ] Logo definitif

---

## Backlog fonctionnel

### P0 — Prioritaires
- [ ] Fond anime meteo dynamique (nuages animes, luminosite selon heure)
- [ ] Fiabiliser la precision AR (calibration boussole, compensation derive)
- [ ] Reperes encore plus fins : numeros de rue, noms d'immeubles, enseignes

### P1 — Ameliorations
- [ ] Notifications push (pleine lune, super lune, eclipse)
- [ ] Mode "Golden Hour" : quand la Lune sera la plus photogenique
- [ ] Historique des phases (calendrier lunaire)
- [ ] Partage social ("La Lune ce soir depuis [lieu]")
- [ ] Domaine custom (moon-agnes.fr ou similaire)

### P2 — Nice to have
- [ ] Widget iOS (Shortcuts/Siri)
- [ ] Apple Watch complication
- [ ] Mode hors-ligne complet (calcul lunaire fonctionne, landmarks en cache)
- [ ] Multi-langue (FR/EN/EL)

---

## Deploiement

**GitHub Pages** (gratuit, automatique) :
- Chaque `git push origin main` declenche un redeploy
- HTTPS force, CDN mondial
- Pas de build step necessaire (fichiers statiques)

### Workflow de mise a jour
```bash
cd ~/Documents/moon-tracker-agnes
# ... faire les modifications ...
# IMPORTANT : incrementer ?v=N dans index.html
git add -A
git commit -m "Description des changements"
git push
# Live en 1-2 minutes sur https://mickael-tsakiris.github.io/moon-tracker-agnes/
```

### Test local
```bash
cd ~/Documents/moon-tracker-agnes
python3 -m http.server 3456
# Ouvrir http://localhost:3456
```

### Test sur iPhone (tunnel temporaire)
```bash
# Necessite cloudflared installe
cloudflared tunnel --url http://localhost:3456
# Donne une URL https://xxx.trycloudflare.com temporaire
```

---

## APIs externes — limites et quotas

| API | Quota | Notes |
|---|---|---|
| Overpass (OSM) | Pas de cle, rate-limit souple | Respecter 1 req/s, timeout 10s |
| Nominatim (OSM) | 1 req/s, User-Agent obligatoire | UA configure : "MoonTrackerAgnes/1.0" |
| Open-Meteo | Gratuit, 10 000 req/jour | Pas de cle requise |
| Astronomy Engine | Local (CDN JS) | Aucun appel reseau |

---

## Historique des problemes resolus

1. **Geoloc bloquee en HTTP** : l'API Geolocation exige HTTPS (sauf localhost). Solution : tunnel Cloudflare puis GitHub Pages.
2. **Cache navigateur** : le Service Worker cache l'ancien app.js. Solution : version query param `?v=N`.
3. **Pitch AR inverse** : `90 - beta` au lieu de `beta - 90`. Le telephone pointant en bas affichait la Lune.
4. **Landmarks trop loin** : musee a 1.5km inutile depuis un 2e etage avec vis-a-vis. Rayon reduit a 250m.
5. **Descriptions sans contexte** : "Lune a gauche" ne veut rien dire. Ajout systematique d'un 2e repere d'orientation.
6. **Fond anime invisible** : cartes opaques cachaient le canvas stars. Surfaces rendues semi-transparentes.
