# Moon Tracker Agnes — v31

## Projet
PWA pour Agnes. Localise la Lune avec des reperes physiques (rues, commerces, monuments).

**URL** : https://mickael-tsakiris.github.io/moon-tracker-agnes/

## Stack
HTML/CSS/JS vanilla, Astronomy Engine, Overpass API, Nominatim, Open-Meteo, DeviceOrientation, getUserMedia

## Bugs critiques a corriger (prochaine session)
1. Phase lunaire : 45% semble ~50% visuellement. Verifier terminateur arc+ellipse
2. Verifier cerclage blanc disparu (approche destination-out v30)
3. Landmarks : recherche progressive 150/350/600m. Tester sur iPhone
4. Ciel CSS : affiner couleurs + nuages animes
5. Lune : blur 1.2px + tint heure. User veut rendu oeil nu (crateres doux, pas satellite)
6. Design global : se rapprocher Apple Weather

## Decisions techniques
- Face sombre = transparente (destination-out), ciel passe a travers
- Tilt attenue 35% (lisibilite vs precision astronomique)
- Ciel en CSS (plus de canvas), pilote par Astronomy.Horizon
- Landmarks progressifs (150m → 350m → 600m)
- Geoloc fallback Paris 17e si geoloc bloquee

## Dev local
python3 -m http.server 3456
## Deploy
git push (GitHub Pages auto)
