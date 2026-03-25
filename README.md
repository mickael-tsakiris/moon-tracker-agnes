# Moon Tracker Agnes — v31

## Projet
PWA pour Agnes (femme de Mickael). Localise la Lune en temps reel avec des reperes physiques de l'environnement immediat (rues, commerces, monuments a 50-200m), PAS des coordonnees.

**URL** : https://mickael-tsakiris.github.io/moon-tracker-agnes/
**Repo** : github.com/mickael-tsakiris/moon-tracker-agnes

## Stack
HTML/CSS/JS vanilla, Astronomy Engine, Overpass API, Nominatim, Open-Meteo, DeviceOrientation, getUserMedia

## Architecture
- index.html, style.css, app.js (~1550 lignes), moon-texture.jpg (NASA SVS 730x730), manifest.json, sw.js
- 4 onglets : LUNE, CAMERA (AR), DETAILS, A PROPOS

---

## FEEDBACK CRITIQUE DE MICKAEL — A RESPECTER IMPERATIVEMENT

### LUNE (rendering)
- **Le rendu actuel est "un dessin d'enfant de 6 ans"** — doit etre au niveau Apple Weather
- **Cerclage blanc** : bug persistant depuis 10+ versions. Vient de l'anti-aliasing du clip canvas et/ou des bords de l'image. L'approche destination-out (v30) devait le resoudre mais A VERIFIER
- **Phase INCORRECTE** : a 45% illuminee, le rendu visuel montre ~50%. Le terminateur (arc + ellipse) semble mathematiquement correct (tw = r * |2*frac - 1|) mais le resultat visuel ne correspond pas. BUG NON RESOLU.
- **Image lune = ce qu'on voit a l'oeil nu** : crateres visibles mais DOUX (blur atmospherique ~1.2px), pas une photo satellite nette. Les maria doivent etre des taches diffuses.
- **Couleur selon l'heure** : doree-argentee la nuit, pale/blanche de jour, legere teinte chaude au crepuscule
- **Terminateur (limite clair/obscur) doit etre ADOUCI/FLOUTE** — pas de coupure nette. Benchmark les apps meteo/astrologie pour voir comment elles font.
- **Glow/halo UNIQUEMENT cote eclaire**, jamais cote sombre
- **ZERO cerclage, ZERO bordure blanche, ZERO rim highlight**
- Le fond de la face sombre = TRANSPARENT (le ciel passe a travers). Aucun aplat noir ou colore.

### CIEL (background)
- **"Affreux, pas realiste du tout"** avec le canvas procedural — remplace par CSS (v29)
- **Doit refleter l'heure REELLE** : pas d'etoiles a 9h du matin ! Utiliser Astronomy.Horizon() pour l'altitude du soleil, pas getHours()
- **Progression CONTINUE** du ciel, pas des tranches "de telle heure a telle heure = nuit"
- **Doit refleter la METEO reelle** : couverture nuageuse de l'API Open-Meteo → opacite nuages, desaturation couleurs
- **Reference absolute = Apple Weather** : gradient atmospherique, nuages animes subtils, transitions fluides
- **Nuages animes** : doux, realistes, qui derivent — pas des ellipses cartoon

### DESIGN GLOBAL
- **Reference = Apple Weather** (animations, cartes verre depoli, qualite photo)
- **Glassmorphism = "bof"** — preferer "frosted depth" subtil avec grain
- **Bordure doree = "ringard"** — monochromie + accent unique discret
- **Typographie** : Geist Sans ou Satoshi, PAS de serif classique type Cormorant Garamond
- **Awwwards SOTD** comme benchmark design, pas des templates generiques
- **Animations fonctionnelles** 150-300ms, easings non-lineaires

### LANDMARKS / "OU REGARDER"
- **JAMAIS de "direction sud-est"** — c'est EXACTEMENT ce que le user ne veut pas
- Reperes PHYSIQUES de l'environnement IMMEDIAT : la rue devant toi, le commerce en bas, l'immeuble d'en face
- **Un musee a 1.5km = INUTILE** quand tu es au 2e etage avec du vis-a-vis
- Rayon cible : 50-200m. Recherche progressive : 150m → 350m → 600m (s'arrete des que 2+ resultats)
- TOUJOURS donner un 2e repere d'orientation : "a gauche QUAND TU REGARDES VERS [rue X]"
- Inclure commerces (boulangerie, pharmacie), pas seulement monuments/eglises
- Si la Lune est sous l'horizon : indiquer ou elle apparaitra AVEC un repere physique

### CAMERA AR
- Pitch corrige : formule = beta - 90 (pas 90 - beta)
- Calibration amelioree, smoothing sur heading et pitch
- Le user pointait vers le sol et l'app disait "la Lune est la" → BUG CORRIGE
- A tester : precision du tracking, reactivite de la fleche directionnelle

### PROCESS DE DEV
- **"Tu dois faire des tests de non-regression avant de pousser chaque version"**
- **"Plus on avance, plus tu regresses"** — chaque push doit etre VERIFIE (syntax + fonctions core + pas de regression)
- **Tester visuellement** avant push, pas juste la syntaxe JS
- Ne pas empiler 10 changements sans tester — iterer proprement

---

## Decisions techniques validees
- Face sombre = transparente (destination-out), ciel passe a travers
- Tilt attenue a 35% de la valeur astronomique (lisibilite)
- Ciel en CSS (plus de canvas), pilote par Astronomy.Horizon
- Service worker network-first (pas de cache pendant le dev)
- Geoloc fallback Paris 17e (48.8835, 2.3219) si geoloc bloquee
- Photo lune : NASA SVS 730x730 avec blur atmospherique

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
