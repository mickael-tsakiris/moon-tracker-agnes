# CLAUDE.md — Moon Tracker Agnes

## Projet
PWA vanilla JS pour Agnes. Localise la Lune avec des reperes physiques (rues, commerces).
Benchmark design = Apple Weather. Zero framework, zero bundler.
**URL** : https://mickael-tsakiris.github.io/moon-tracker-agnes/
**Version** : v37

## Fichiers cles
- `app.js` — toute la logique (~2100 lignes), sections avec headers `// ==== NOM ====`
- `style.css` — design system complet, variables CSS, responsive
- `index.html` — structure + SVG filters (terminatorBlur)
- `sw.js` — service worker network-first, cache versionne, push + notificationclick listeners
- `moon-texture.jpg` — photo pleine lune NASA 512x512
- `manifest.json` — PWA manifest, start_url="./" scope="./"
- `apple-touch-icon.png` — icone 180x180 (generee depuis moon-texture.jpg)
- `icon-192.png`, `icon-512.png` — icones manifest

## Push Notifications (v37)
- **Cloudflare Worker** : `https://moon-push.mickael-tsakiris.workers.dev`
- **Cron** : 17h + 18h UTC (couvre CET/CEST) — verifie lune visible avant envoi
- **Conditions d'envoi** : altitude > 5°, couverture nuageuse < 70%, illumination > 5%
- **KV namespace** : `47a3ae3a17ff47598e44be69b72239af` (stocke les subscriptions push)
- **VAPID keys** : en secrets Cloudflare (generees 2026-03-25)
- **Fichiers worker/** : `index.js`, `landmarks.js`, `wrangler.toml`, `package.json`
- **Messages** : contextualises a la sortie du Retiro ("regarde sur ta droite, vers la Concorde")
- **Endpoints** : `/subscribe` (POST), `/status` (GET), `/test` (POST)
- **Redeploy** : `cd worker && npx wrangler deploy`

## Raccourci iOS Agnes
- App Raccourcis > Automatisation > Quitter [33 rue Boissy d'Anglas] > Ouvrir Moon Tracker
- A configurer sur l'iPhone d'Agnes

## Regles de deploy
1. Bumper CACHE_NAME dans sw.js
2. Bumper ?v= dans index.html (style.css ET app.js)
3. Les 3 versions DOIVENT etre identiques
4. `git push` deploie sur GitHub Pages (~2 min)
5. Si worker modifie : `cd worker && npx wrangler deploy`
6. Envoyer un message a Agnes 10 min apres chaque deploy majeur

## Contraintes techniques iOS Safari
- `canvas.filter = 'blur()'` NE FONCTIONNE PAS — utiliser SVG feGaussianBlur
- Weather canvas DOIT etre hors de #sky-bg, en position fixed z-9999
- DeviceOrientationEvent.requestPermission() requis pour boussole/AR
- getUserMedia necessite HTTPS
- **Push** : PushManager dispo UNIQUEMENT en mode standalone (ecran d'accueil)
- **Push** : Notification.requestPermission() DOIT etre dans un handler de click
- **Push** : Service worker DOIT etre register() dans DOMContentLoaded AVANT tout usage push
- **Cache standalone** : tres collant. Purger via Reglages > Safari > Donnees de sites

## Pieges connus
- Ne jamais utiliser CSS `composes:` (syntaxe CSS Modules, invalide en standard)
- Le service worker cache agressivement — toujours bumper les versions
- Les descriptions meteo DOIVENT utiliser getWeatherText(wmo_code), jamais generique
- Le terminateur lune = SVG blur, pas canvas blur, pas box blur manuel
- VAPID key : utiliser urlBase64ToUint8Array(), jamais atob() direct
- TOUJOURS tester en local (preview) avant de demander a Mickael de tester sur iPhone

## Agnes
- agnes.benveniste@gmail.com
- WhatsApp +33 603232477
- Travaille au 33 rue Boissy d'Anglas, Paris 8e (Cite Retiro, bureaux Cartier)
- Heure de sortie variable
- Notification apres chaque deploy majeur (nouveautes + marche a suivre cache)

## Dev local
```
python3 -m http.server 3456
# HTTPS pour iOS : npx cloudflared tunnel --url http://localhost:3456
```

## Qualite
- node --check app.js avant chaque commit
- Verifier visuellement avant push (preview server)
- Zero dead code, zero fichiers orphelins
- Toujours signaler les erreurs (fichiers introuvables, fetch echoues) — ne jamais ignorer silencieusement
