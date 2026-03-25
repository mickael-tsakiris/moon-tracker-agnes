import { Body, MakeTime, Observer, Equator, Horizon, MoonPhase, Illumination } from 'astronomy-engine';
import { OBSERVER, findNearestLandmark, altitudeText, phaseName } from './landmarks.js';

// ==== CORS headers ====
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

// ==== Moon calculation ====
function calculateMoon(lat, lng) {
  const now = new Date();
  const time = MakeTime(now);
  const observer = new Observer(lat, lng, 0);

  const eq = Equator(Body.Moon, time, observer, true, true);
  const hor = Horizon(time, observer, eq.ra, eq.dec, 'normal');
  const phase = MoonPhase(time);
  const illum = Illumination(Body.Moon, time);

  return {
    azimuth: hor.azimuth,
    altitude: hor.altitude,
    isAboveHorizon: hor.altitude > 0,
    phase: phase,
    fraction: illum.phase_fraction,
    phaseName: phaseName(phase)
  };
}

// ==== Weather check ====
async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=weather_code,cloud_cover,precipitation,is_day&timezone=auto`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Weather API failed');
  const data = await resp.json();
  return {
    weatherCode: data.current.weather_code,
    cloudCover: data.current.cloud_cover,
    precipitation: data.current.precipitation,
    isDay: data.current.is_day
  };
}

function weatherText(code) {
  const map = {
    0: 'ciel dégagé', 1: 'peu nuageux', 2: 'partiellement nuageux', 3: 'ciel couvert',
    45: 'brouillard', 48: 'brouillard givrant',
    51: 'bruine légère', 53: 'bruine', 55: 'bruine forte',
    61: 'pluie légère', 63: 'pluie', 65: 'forte pluie',
    71: 'neige légère', 73: 'neige', 75: 'forte neige',
    80: 'averses légères', 81: 'averses', 82: 'fortes averses',
    95: 'orage', 96: 'orage et grêle', 99: 'orage violent'
  };
  return map[code] || 'conditions variables';
}

// ==== Visibility check ====
// Returns { visible: boolean, reason: string }
function checkVisibility(moon, weather) {
  if (!moon.isAboveHorizon || moon.altitude < 5) {
    return { visible: false, reason: 'La lune est sous l\'horizon.' };
  }
  if (moon.fraction < 0.05) {
    return { visible: false, reason: 'Nouvelle lune — pas visible.' };
  }
  if (weather.cloudCover > 70) {
    return { visible: false, reason: `Ciel trop couvert (${weather.cloudCover}%).` };
  }
  if (weather.precipitation > 1) {
    return { visible: false, reason: 'Précipitations en cours.' };
  }
  // Altitude basse + immeubles haussmanniens (~25m)
  // A 50m de distance, 25m de haut = arctan(25/50) ≈ 27°
  // Mais les rues sont plus larges, et on regarde au loin — seuil réaliste ~10°
  if (moon.altitude < 10) {
    return { visible: true, reason: 'La lune est basse — elle sera peut-être masquée par les immeubles.' };
  }
  return { visible: true, reason: '' };
}

// ==== Message generation ====
function generateMessage(moon, weather) {
  const landmark = findNearestLandmark(moon.azimuth);
  const alt = altitudeText(moon.altitude);
  const phase = moon.phaseName;
  const meteo = weatherText(weather.weatherCode);

  let msg = `Agnès, lève la tête !`;

  if (landmark.angleDiff < 15) {
    // Très proche d'un repère
    msg += ` Regarde vers ${landmark.name}, la Lune est ${alt}.`;
  } else if (landmark.secondDiff < 30) {
    // Entre deux repères
    msg += ` La Lune est ${alt}, entre ${landmark.name} et ${landmark.second.name}.`;
  } else {
    msg += ` La Lune est ${alt}, du côté de ${landmark.name}.`;
  }

  // Low altitude warning — immeubles haussmanniens ~25m
  if (moon.altitude < 10 && moon.altitude >= 5) {
    msg += ' Elle est basse, peut-être cachée par les immeubles.';
  }

  msg += ` ${phase}, ${meteo}.`;
  return msg;
}

// ==== Check if it's evening in Paris ====
function isParisEvening() {
  const now = new Date();
  const parisTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const hour = parisTime.getHours();
  return hour >= 17 && hour <= 21;
}

// ==== Web Push ====
async function sendPush(subscription, payload, env) {
  const { endpoint, keys } = subscription;
  const { p256dh, auth } = keys;

  // Import VAPID keys
  const vapidPublic = env.VAPID_PUBLIC_KEY;
  const vapidPrivate = env.VAPID_PRIVATE_KEY;

  // Use the web push protocol directly
  // We need to construct the push message with VAPID authentication
  const pushData = JSON.stringify(payload);

  // For Cloudflare Workers, we use the web-push protocol manually
  // The subscription endpoint is a URL we POST to with encrypted payload

  // Simple approach: use the endpoint directly with proper headers
  // This requires implementing the Web Push encryption protocol

  // Since Cloudflare Workers have crypto API, we implement VAPID + encryption
  const response = await webPushSend(endpoint, p256dh, auth, pushData, vapidPublic, vapidPrivate, env.VAPID_SUBJECT);
  return response;
}

// ==== Web Push Protocol Implementation ====
// VAPID + ECDH + HKDF + AECGCM encryption for Web Push

async function webPushSend(endpoint, p256dhBase64, authBase64, payload, vapidPublicKey, vapidPrivateKey, subject) {
  // 1. Generate VAPID JWT
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const vapidToken = await generateVapidJwt(audience, subject, vapidPrivateKey, vapidPublicKey);

  // 2. Encrypt the payload
  const encrypted = await encryptPayload(p256dhBase64, authBase64, payload);

  // 3. Send to push service
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${vapidToken.jwt}, k=${vapidPublicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'normal'
    },
    body: encrypted
  });

  return { status: resp.status, ok: resp.ok };
}

// Base64url helpers
function base64urlToBuffer(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(pad);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateVapidJwt(audience, subject, privateKeyBase64, publicKeyBase64) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: audience,
    exp: now + 86400,
    sub: subject
  };

  const headerB64 = bufferToBase64url(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = bufferToBase64url(new TextEncoder().encode(JSON.stringify(claims)));
  const unsigned = `${headerB64}.${claimsB64}`;

  // Import private key
  const privateKeyBuffer = base64urlToBuffer(privateKeyBase64);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    convertRawPrivateKeyToPKCS8(privateKeyBuffer, base64urlToBuffer(publicKeyBase64)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  // Convert DER signature to raw r||s format for JWT
  const sigBytes = new Uint8Array(signature);
  const rawSig = derToRaw(sigBytes);

  return { jwt: `${unsigned}.${bufferToBase64url(rawSig)}` };
}

// Convert raw 32-byte private key to PKCS8 DER format
function convertRawPrivateKeyToPKCS8(rawPrivateKey, publicKey) {
  // PKCS8 wrapper for EC P-256 private key
  const pkcs8Header = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13,
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02,
    0x01, 0x01, 0x04, 0x20
  ]);
  const midSection = new Uint8Array([0xa1, 0x44, 0x03, 0x42, 0x00]);

  const result = new Uint8Array(pkcs8Header.length + 32 + midSection.length + publicKey.length);
  result.set(pkcs8Header);
  result.set(rawPrivateKey, pkcs8Header.length);
  result.set(midSection, pkcs8Header.length + 32);
  result.set(publicKey, pkcs8Header.length + 32 + midSection.length);
  return result;
}

// Convert DER-encoded ECDSA signature to raw 64-byte r||s
function derToRaw(der) {
  // If already 64 bytes, it's already raw
  if (der.length === 64) return der;

  const raw = new Uint8Array(64);
  // DER: 0x30 len 0x02 rLen r 0x02 sLen s
  let offset = 2; // skip 0x30 and total length
  if (der[0] !== 0x30) return der; // not DER, return as-is

  // R
  offset++; // 0x02
  const rLen = der[offset++];
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;

  // S
  offset++; // 0x02
  const sLen = der[offset++];
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 64 - sLen : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);

  return raw;
}

// ==== Web Push Encryption (aes128gcm) ====
async function encryptPayload(p256dhBase64, authBase64, plaintext) {
  const clientPublicKey = base64urlToBuffer(p256dhBase64);
  const authSecret = base64urlToBuffer(authBase64);

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // Export local public key (uncompressed point)
  const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  // Import client public key
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey },
    localKeyPair.privateKey,
    256
  ));

  // HKDF for auth info
  const authInfo = concatBuffers(
    new TextEncoder().encode('WebPush: info\0'),
    clientPublicKey,
    localPublicKeyRaw
  );

  const ikm = await hkdf(authSecret, sharedSecret, authInfo, 32);

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive content encryption key and nonce
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');

  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Pad plaintext (add 0x02 delimiter + optional padding)
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const padded = new Uint8Array(plaintextBytes.length + 1);
  padded.set(plaintextBytes);
  padded[plaintextBytes.length] = 0x02; // delimiter

  // AES-128-GCM encrypt
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    padded
  ));

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + localPublicKeyRaw.length);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = localPublicKeyRaw.length;
  header.set(localPublicKeyRaw, 21);

  return concatBuffers(header, encrypted);
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

function concatBuffers(...buffers) {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

// ==== API Routes ====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // POST /subscribe — store push subscription
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        const sub = await request.json();
        if (!sub.endpoint || !sub.keys) {
          return json({ error: 'Invalid subscription' }, 400);
        }
        // Store with endpoint as key
        const key = btoa(sub.endpoint).slice(0, 64);
        await env.PUSH_SUBS.put(key, JSON.stringify(sub), { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true, message: 'Subscription stored' });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // POST /test — send test notification NOW (for debugging)
    if (url.pathname === '/test' && request.method === 'POST') {
      return handlePushCheck(env, true);
    }

    // GET /status — check moon + weather conditions
    if (url.pathname === '/status') {
      const moon = calculateMoon(OBSERVER.lat, OBSERVER.lng);
      const weather = await fetchWeather(OBSERVER.lat, OBSERVER.lng);
      const visibility = checkVisibility(moon, weather);
      const message = visibility.visible ? generateMessage(moon, weather) : visibility.reason;

      return json({
        moon,
        weather,
        visibility,
        message,
        parisEvening: isParisEvening(),
        observer: OBSERVER
      });
    }

    return json({ error: 'Not found' }, 404);
  },

  // Cron trigger — runs daily at configured times
  async scheduled(event, env) {
    // Only send if it's evening in Paris
    if (!isParisEvening()) return;
    await handlePushCheck(env, false);
  }
};

// ==== Core push logic ====
async function handlePushCheck(env, forceSend) {
  const moon = calculateMoon(OBSERVER.lat, OBSERVER.lng);
  const weather = await fetchWeather(OBSERVER.lat, OBSERVER.lng);
  const visibility = checkVisibility(moon, weather);

  if (!visibility.visible && !forceSend) {
    return json({ sent: false, reason: visibility.reason });
  }

  const message = generateMessage(moon, weather);
  const payload = {
    title: 'Agnès, la Lune t\'attend !',
    body: message,
    url: './'
  };

  // Get all subscriptions from KV
  const list = await env.PUSH_SUBS.list();
  let sent = 0;
  let failed = 0;

  for (const key of list.keys) {
    try {
      const subJson = await env.PUSH_SUBS.get(key.name);
      if (!subJson) continue;
      const sub = JSON.parse(subJson);
      const result = await sendPush(sub, payload, env);
      if (result.ok) {
        sent++;
      } else if (result.status === 410 || result.status === 404) {
        // Subscription expired — clean up
        await env.PUSH_SUBS.delete(key.name);
        failed++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  return json({ sent, failed, message, visibility });
}
