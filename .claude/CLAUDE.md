# CLAUDE.md — Moon Tracker Agnes

## Projet
PWA vanilla JS pour Agnes. Localise la Lune avec des reperes physiques (rues, commerces).
Benchmark design = Apple Weather. Zero framework, zero bundler.

## Fichiers cles
- `app.js` — toute la logique (~1890 lignes), sections avec headers `// ==== NOM ====`
- `style.css` — design system complet, variables CSS, responsive
- `index.html` — structure + SVG filters (terminatorBlur)
- `sw.js` — service worker network-first, cache versionne
- `moon-texture.jpg` — photo pleine lune NASA 512x512

## Regles de deploy
1. Bumper CACHE_NAME dans sw.js
2. Bumper ?v= dans index.html (style.css ET app.js)
3. Les 3 versions DOIVENT etre identiques
4. `git push` deploie sur GitHub Pages (~2 min)
5. Envoyer un message a Agnes 10 min apres chaque deploy majeur

## Contraintes techniques iOS Safari
- `canvas.filter = 'blur()'` NE FONCTIONNE PAS — utiliser SVG feGaussianBlur
- Weather canvas DOIT etre hors de #sky-bg, en position fixed z-9999
- DeviceOrientationEvent.requestPermission() requis pour boussole/AR
- getUserMedia necessite HTTPS

## Pieges connus
- Ne jamais utiliser CSS `composes:` (syntaxe CSS Modules, invalide en standard)
- Le service worker cache agressivement — toujours bumper les versions
- Les descriptions meteo DOIVENT utiliser getWeatherText(wmo_code), jamais generique
- Le terminateur lune = SVG blur, pas canvas blur, pas box blur manuel

## Agnes
- agnes.benveniste@gmail.com
- WhatsApp +33 603232477
- Notification apres chaque deploy majeur (nouveautes + marche a suivre cache)

## Dev local
```
python3 -m http.server 3456
# HTTPS pour iOS : npx cloudflared tunnel --url http://localhost:3456
```

## Qualite
- node --check app.js avant chaque commit
- Verifier visuellement avant push
- Zero dead code, zero fichiers orphelins
- Toujours signaler les erreurs (fichiers introuvables, fetch echoues) — ne jamais ignorer silencieusement
