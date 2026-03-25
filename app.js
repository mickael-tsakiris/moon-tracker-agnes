/* ============================
   Moon Tracker Agnès — v4
   ============================ */

const CONFIG = {
  landmarkRadius: 150,
  updateInterval: 60000,
  overpassApi: 'https://overpass-api.de/api/interpreter',
  nominatimApi: 'https://nominatim.openstreetmap.org/reverse',
  openMeteoApi: 'https://api.open-meteo.com/v1/forecast',
  maxLandmarks: 25,
  compassSmoothing: 0.15
};

const state = {
  lat: null, lng: null, heading: null,
  compassAvailable: false,
  moonData: null, landmarks: [], locationName: '',
  cloudCover: null, precipitation: 0, snowfall: 0, windSpeed: 0, weatherCode: 0, isDay: 1, nightMode: false, updateTimer: null,
  currentTab: 'home'
};

const $ = id => document.getElementById(id);
const sky = {}; // kept for compat — CSS sky now handles rendering

// ============================
// INIT
// ============================
document.addEventListener('DOMContentLoaded', () => {
  // Start CSS sky
  try { updateSky(); setInterval(updateSky, 60000); } catch (e) { console.error('Sky init error:', e); }

  $('btn-start')?.addEventListener('click', () => {
    // Request push permission on user gesture (required by iOS)
    subscribeToPush().catch(e => console.log('Push:', e.message));
    startApp();
  });
  $('btn-retry')?.addEventListener('click', () => { showScreen('loading'); startApp(); });
  $('btn-night')?.addEventListener('click', toggleNight);

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Skip onboarding — launch directly
  startApp();
});

async function startApp() {
  try {
    // Step 1: Get REAL position — no silent fallback
    let usingFallback = false;
    try {
      const pos = await getLocation();
      state.lat = pos.coords.latitude;
      state.lng = pos.coords.longitude;
    } catch (geoErr) {
      // Show a clear, blocking message — user MUST allow geolocation
      const retry = await showGeoPermissionRequest(geoErr.message);
      if (retry) {
        // User tapped retry — try again
        try {
          const pos2 = await getLocation();
          state.lat = pos2.coords.latitude;
          state.lng = pos2.coords.longitude;
        } catch (_) {
          // Second attempt failed — use fallback but WARN clearly
          state.lat = 48.8566;
          state.lng = 2.3522;
          usingFallback = true;
        }
      } else {
        state.lat = 48.8566;
        state.lng = 2.3522;
        usingFallback = true;
      }
    }

    // Step 2: Calculate moon INSTANTLY (offline, no network) and show UI
    calculateMoon();
    if (usingFallback) {
      state.locationName = 'Paris (position approximative)';
      // Show persistent warning banner
      const banner = document.createElement('div');
      banner.id = 'geo-warning';
      banner.style.cssText = `
        position:fixed;top:0;left:0;right:0;z-index:999;
        background:rgba(180,80,40,0.9);color:#fff;text-align:center;
        padding:0.6rem 1rem;font-size:0.8rem;backdrop-filter:blur(8px);
      `;
      banner.textContent = 'Position approximative — autorise la géolocalisation pour des résultats précis';
      banner.onclick = () => { banner.remove(); startApp(); };
      document.body.appendChild(banner);
    }
    renderAll();
    showScreen('app');
    setupCompassButton();

    // Step 3: Fetch landmarks, location name, weather IN BACKGROUND (non-blocking)
    fetchLandmarks().then(lm => {
      state.landmarks = lm;
      matchMoonToLandmarks();
      renderAll(); // re-render with landmarks
    }).catch(() => {});

    fetchLocationName().then(name => {
      if (!usingFallback) state.locationName = name;
      renderAll();
    }).catch(() => {});

    fetchCloudCover().then(cc => {
      state.cloudCover = cc;
      renderAll();
    }).catch(() => {});

    state.updateTimer = setInterval(refresh, CONFIG.updateInterval);

    // Step 4: Push notifications
    if (localStorage.getItem('push-subscribed') === 'true') {
      // Already subscribed — re-check silently
      subscribeToPush().catch(e => console.log('Push re-check skipped:', e.message));
    } else if (!localStorage.getItem('push-dismissed')) {
      // Show notification banner after 3s (needs user gesture for iOS)
      setTimeout(showNotificationBanner, 3000);
    }

  } catch (err) {
    console.error('Init error:', err);
    showError(err.message || 'Une erreur est survenue.');
  }
}

async function refresh() {
  if (!state.lat) return;
  calculateMoon();
  matchMoonToLandmarks();
  try { state.cloudCover = await fetchCloudCover(); } catch (_) {}
  drawSkyBackground();
  renderAll();
}

// ============================
// GEOLOCATION
// ============================
function showGeoPermissionRequest(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'geo-overlay';
    overlay.innerHTML = `
      <div style="
        position:fixed;inset:0;z-index:9999;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:rgba(10,10,15,0.95);padding:2rem;text-align:center;
      ">
        <div style="font-size:3rem;margin-bottom:1.5rem;">&#x1F315;</div>
        <h2 style="color:#EDEDED;font-size:1.3rem;margin-bottom:1rem;font-weight:500;">
          J'ai besoin de ta position
        </h2>
        <p style="color:#A1A1A1;font-size:0.95rem;line-height:1.6;max-width:300px;margin-bottom:0.5rem;">
          Pour trouver la Lune autour de toi, autorise la géolocalisation dans les réglages de ton navigateur.
        </p>
        <p style="color:#6B6B6B;font-size:0.8rem;line-height:1.5;max-width:300px;margin-bottom:2rem;">
          Sur iPhone : Réglages > Safari > Position > Autoriser.<br>
          Puis reviens ici et appuie sur Réessayer.
        </p>
        <button id="geo-retry" style="
          background:rgba(255,255,255,0.1);color:#EDEDED;border:1px solid rgba(255,255,255,0.15);
          padding:0.8rem 2.5rem;border-radius:12px;font-size:1rem;cursor:pointer;margin-bottom:0.8rem;
        ">Réessayer</button>
        <button id="geo-skip" style="
          background:none;color:#6B6B6B;border:none;padding:0.5rem;font-size:0.85rem;cursor:pointer;
        ">Continuer sans (position approximative)</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('geo-retry').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    document.getElementById('geo-skip').onclick = () => {
      overlay.remove();
      resolve(false);
    };
  });
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('La géolocalisation n\'est pas disponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, err => {
      reject(new Error(err.code === 1
        ? 'Active la géolocalisation pour trouver la Lune autour de toi.'
        : 'Impossible d\'obtenir ta position. Réessaie en extérieur.'));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

// ============================
// MOON CALCULATIONS
// ============================
function calculateMoon() {
  if (typeof Astronomy === 'undefined') {
    console.error('Astronomy engine not loaded');
    return;
  }

  const now = Astronomy.MakeTime(new Date());
  const observer = new Astronomy.Observer(state.lat, state.lng, 0);
  const eq = Astronomy.Equator('Moon', now, observer, true, true);
  const hor = Astronomy.Horizon(now, observer, eq.ra, eq.dec, 'normal');
  const phaseAngle = Astronomy.MoonPhase(now);
  const illum = Astronomy.Illumination('Moon', now);

  let rise = null, set = null, risePast = null, setPast = null, nextFull = null;
  try { rise = Astronomy.SearchRiseSet('Moon', observer, +1, now, 1); } catch (_) {}
  try { set = Astronomy.SearchRiseSet('Moon', observer, -1, now, 1); } catch (_) {}

  const startOfDay = Astronomy.MakeTime(new Date(new Date().setHours(0, 0, 0, 0)));
  try { risePast = Astronomy.SearchRiseSet('Moon', observer, +1, startOfDay, 1); } catch (_) {}
  try { setPast = Astronomy.SearchRiseSet('Moon', observer, -1, startOfDay, 1); } catch (_) {}
  try { nextFull = Astronomy.SearchMoonPhase(180, now, 30); } catch (_) {}

  // Calculate terminator tilt: angle of bright limb on observer's sky
  // Sun position in observer's sky
  const sunEq = Astronomy.Equator('Sun', now, observer, true, true);
  const sunHor = Astronomy.Horizon(now, observer, sunEq.ra, sunEq.dec, 'normal');

  // Position angle of sun relative to moon on the sky (from "up"/zenith direction)
  const moonAltRad = hor.altitude * Math.PI / 180;
  const moonAzRad = hor.azimuth * Math.PI / 180;
  const sunAltRad = sunHor.altitude * Math.PI / 180;
  const sunAzRad = sunHor.azimuth * Math.PI / 180;
  const dAz = sunAzRad - moonAzRad;

  // Position angle of the bright limb measured from "up" on the moon disk
  // "Up" = toward zenith when looking at the moon
  const brightLimbAngle = Math.atan2(
    Math.cos(sunAltRad) * Math.sin(dAz),
    Math.sin(sunAltRad) * Math.cos(moonAltRad) -
    Math.cos(sunAltRad) * Math.sin(moonAltRad) * Math.cos(dAz)
  );

  // The terminator is perpendicular to the bright limb direction
  // Rotation to apply to the phase rendering (in radians)
  const terminatorTilt = brightLimbAngle;

  state.moonData = {
    azimuth: hor.azimuth,
    altitude: hor.altitude,
    distance: eq.dist,
    phaseAngle,
    phase: phaseAngle / 360,
    fraction: illum.phase_fraction,
    terminatorTilt,
    rise: rise?.date || null,
    set: set?.date || null,
    risePast: risePast?.date || null,
    setPast: setPast?.date || null,
    nextFull: nextFull?.date || null,
    isAboveHorizon: hor.altitude > -0.5
  };
}

function getPhaseName(a) {
  if (a < 11.25) return 'Nouvelle Lune';
  if (a < 78.75) return 'Premier croissant';
  if (a < 101.25) return 'Premier quartier';
  if (a < 168.75) return 'Gibbeuse croissante';
  if (a < 191.25) return 'Pleine Lune';
  if (a < 258.75) return 'Gibbeuse décroissante';
  if (a < 281.25) return 'Dernier quartier';
  if (a < 348.75) return 'Dernier croissant';
  return 'Nouvelle Lune';
}

// ============================
// LANDMARKS + STREETS (Nominatim-based, always works)
// ============================
async function fetchLandmarks() {
  const results = [];
  const seen = new Set();

  // Strategy 1: Street names in 12 directions, VERY close (100m) — what you can actually see
  const directions = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const distanceM = 60; // 60m — what you can see from your window
  const toRad = Math.PI / 180;

  const streetPromises = directions.map(async (az) => {
    const dLat = (distanceM / 111320) * Math.cos(az * toRad);
    const dLng = (distanceM / (111320 * Math.cos(state.lat * toRad))) * Math.sin(az * toRad);
    const pLat = state.lat + dLat;
    const pLng = state.lng + dLng;

    try {
      const resp = await fetch(
        `${CONFIG.nominatimApi}?lat=${pLat}&lon=${pLng}&format=json&zoom=17&accept-language=fr`,
        { headers: { 'User-Agent': 'MoonTrackerAgnes/1.0' } }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const road = data.address?.road || data.address?.pedestrian || data.address?.footway;
      if (!road || seen.has(road)) return null;
      seen.add(road);

      return {
        name: road,
        kind: 'rue',
        isStreet: true,
        isPark: false,
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lon),
        bearing: az,
        distance: distanceM
      };
    } catch (_) { return null; }
  });

  // Strategy 2: Overpass for monuments + nearby shops/cafes (may fail — that's OK)
  const overpassPromise = fetchOverpassPOIs().catch(() => []);
  const shopsPromise = fetchOverpassNearby().catch(() => []);

  // Run all in parallel
  const [streets, pois, shops] = await Promise.all([
    Promise.all(streetPromises),
    overpassPromise,
    shopsPromise
  ]);

  // Merge results: POIs first, then shops/cafes, then streets
  pois.forEach(p => { if (p && !seen.has(p.name)) { seen.add(p.name); results.push(p); } });
  shops.forEach(s => { if (s && !seen.has(s.name)) { seen.add(s.name); results.push(s); } });
  streets.forEach(s => { if (s) results.push(s); });

  return results;
}

// Lightweight Overpass query — big landmarks with short timeout
async function fetchOverpassPOIs() {
  // Progressive search: very close first, expand only if needed
  const radii = [80, 150, 300];
  for (const r of radii) {
    const query = `[out:json][timeout:8];(
      node["tourism"="attraction"](around:${r},${state.lat},${state.lng});
      node["tourism"="museum"](around:${r},${state.lat},${state.lng});
      node["historic"="monument"](around:${r},${state.lat},${state.lng});
      node["amenity"="place_of_worship"](around:${r},${state.lat},${state.lng});
      node["railway"="station"](around:${r},${state.lat},${state.lng});
      node["leisure"="park"]["name"](around:${r},${state.lat},${state.lng});
      node["shop"]["name"](around:${Math.min(r, 100)},${state.lat},${state.lng});
    );out 15;`;

    try {
      const resp = await fetch(CONFIG.overpassApi, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const results = data.elements
        .filter(el => el.tags?.name && el.lat && el.lon)
        .map(el => ({
          name: el.tags.name,
          kind: el.tags.railway ? 'station' : el.tags.leisure ? 'parc' : el.tags.amenity ? 'edifice' : el.tags.shop ? 'commerce' : el.tags.tourism || 'monument',
          isStreet: false,
          isPark: el.tags.leisure === 'park',
          lat: el.lat,
          lng: el.lon,
          bearing: calcBearing(state.lat, state.lng, el.lat, el.lon),
          distance: haversine(state.lat, state.lng, el.lat, el.lon)
        }));
      if (results.length >= 2) return results; // Enough landmarks, stop expanding
      if (results.length > 0 && r >= 150) return results; // Some results at close range, good enough
    } catch (e) { continue; }
  }
  return []; // Nothing found at any radius
}

// Nearby shops, cafes, pharmacies — within 100m (what you can actually see)
async function fetchOverpassNearby() {
  const r = 100;
  const query = `[out:json][timeout:8];(
    node["amenity"="cafe"](around:${r},${state.lat},${state.lng});
    node["amenity"="pharmacy"](around:${r},${state.lat},${state.lng});
    node["amenity"="restaurant"](around:${r},${state.lat},${state.lng});
    node["shop"="bakery"](around:${r},${state.lat},${state.lng});
    node["shop"="supermarket"](around:${r},${state.lat},${state.lng});
    node["amenity"="school"](around:${r},${state.lat},${state.lng});
    node["amenity"="bank"](around:${r},${state.lat},${state.lng});
  );out 20;`;

  const resp = await fetch(CONFIG.overpassApi, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!resp.ok) return [];
  const data = await resp.json();

  return data.elements
    .filter(el => el.tags?.name && el.lat && el.lon)
    .map(el => ({
      name: el.tags.name,
      kind: el.tags.shop || el.tags.amenity || 'commerce',
      isStreet: false,
      isPark: false,
      lat: el.lat,
      lng: el.lon,
      bearing: calcBearing(state.lat, state.lng, el.lat, el.lon),
      distance: haversine(state.lat, state.lng, el.lat, el.lon)
    }));
}

function matchMoonToLandmarks() {
  if (!state.moonData || !state.landmarks.length) return;
  const az = state.moonData.azimuth;
  state.landmarks.forEach(lm => {
    let diff = az - lm.bearing;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    lm.moonAngleDiff = diff;
    lm.moonAbsDiff = Math.abs(diff);
  });
  state.landmarks.sort((a, b) => a.moonAbsDiff - b.moonAbsDiff);
}

async function fetchLocationName() {
  const resp = await fetch(
    `${CONFIG.nominatimApi}?lat=${state.lat}&lon=${state.lng}&format=json&zoom=16&accept-language=fr`,
    { headers: { 'User-Agent': 'MoonTrackerAgnes/1.0' } }
  );
  if (!resp.ok) return '';
  const data = await resp.json();
  const a = data.address || {};
  const parts = [a.suburb || a.neighbourhood || a.quarter || '', a.city || a.town || a.village || ''];
  return parts.filter(Boolean).join(', ') || '';
}

async function fetchCloudCover() {
  const resp = await fetch(
    `${CONFIG.openMeteoApi}?latitude=${state.lat}&longitude=${state.lng}&current=weather_code,cloud_cover,precipitation,rain,snowfall,wind_speed_10m,is_day&timezone=auto`
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const cur = data.current;
  if (!cur) return null;

  // Store weather data — weatherCode drives sky preset + description text
  state.weatherCode = cur.weather_code ?? 0;
  // Available for future particle intensity tuning:
  state.precipitation = cur.precipitation ?? 0;   // mm/h
  state.snowfall = cur.snowfall ?? 0;              // cm/h
  state.windSpeed = cur.wind_speed_10m ?? 0;       // km/h
  state.isDay = cur.is_day ?? 1;                   // 0=night, 1=day

  updateWeatherEffects();
  return cur.cloud_cover ?? null;
}

// ============================
// WEATHER TEXT FROM WMO CODE
// ============================
function getWeatherText(wc) {
  if (wc >= 99) return 'Orage avec grêle';
  if (wc >= 95) return 'Orage';
  if (wc === 86) return 'Fortes chutes de neige';
  if (wc === 85) return 'Averses de neige';
  if (wc === 82) return 'Averses violentes';
  if (wc === 81) return 'Averses modérées';
  if (wc === 80) return 'Averses légères';
  if (wc === 77) return 'Grains de neige';
  if (wc === 75) return 'Fortes chutes de neige';
  if (wc === 73) return 'Neige modérée';
  if (wc === 71) return 'Neige légère';
  if (wc === 67) return 'Pluie verglaçante forte';
  if (wc === 66) return 'Pluie verglaçante';
  if (wc === 65) return 'Forte pluie';
  if (wc === 63) return 'Pluie modérée';
  if (wc === 61) return 'Pluie légère';
  if (wc === 57) return 'Bruine verglaçante';
  if (wc === 56) return 'Bruine verglaçante';
  if (wc === 55) return 'Bruine dense';
  if (wc === 53) return 'Bruine modérée';
  if (wc === 51) return 'Bruine légère';
  if (wc === 48) return 'Brouillard givrant';
  if (wc === 45) return 'Brouillard';
  if (wc === 3) return 'Ciel couvert';
  if (wc === 2) return 'Partiellement nuageux';
  if (wc === 1) return 'Peu nuageux';
  if (wc === 0) return 'Ciel dégagé';
  return 'Ciel couvert';
}

function getWeatherEmoji(wc) {
  if (wc >= 95) return '';
  if (wc >= 85 || (wc >= 71 && wc <= 77)) return '';
  if (wc >= 80 || (wc >= 61 && wc <= 67)) return '';
  if (wc >= 51 && wc <= 57) return '';
  if (wc === 45 || wc === 48) return '';
  if (wc >= 2) return '';
  return '';
}

// ============================
// DESCRIPTION ENGINE
// ============================
function generateMainDescription() {
  const m = state.moonData;
  if (!m) return 'Calcul en cours...';

  const dir = azToCardinal(m.azimuth);

  // --- Moon below horizon ---
  if (!m.isAboveHorizon) {
    const riseAz = calcMoonRiseAzimuth() || m.azimuth;
    const streetRef = findStreetInDirection(riseAz);
    const anyRef = findAnyPhysicalRef(riseAz);
    if (m.rise && m.rise > new Date()) {
      let desc = `La Lune est sous l'horizon. Elle apparaîtra à ${formatTime(m.rise)}`;
      if (streetRef) desc += `, côté ${streetRef}`;
      else if (anyRef) desc += `, vers ${anyRef}`;
      desc += '.';
      if (state.weatherCode > 0) {
        desc += ` ${getWeatherText(state.weatherCode)}.`;
      } else if (state.cloudCover !== null && state.cloudCover > 70) {
        desc += ` Ciel couvert (${Math.round(state.cloudCover)}%).`;
      }
      return desc;
    }
    return 'La Lune se repose sous l\'horizon. Prochain lever demain.';
  }

  // --- Moon above horizon ---
  // Find the closest STREET in the moon's direction (most useful reference)
  const moonStreet = findStreetInDirection(m.azimuth);
  // Find nearest POI (shop, cafe, etc.) aligned with moon
  const nearPOI = state.landmarks
    .filter(l => !l.isStreet && l.distance < 150)
    .sort((a, b) => a.moonAbsDiff - b.moonAbsDiff)[0];
  const nearPOIAligned = nearPOI && nearPOI.moonAbsDiff < 25;

  // Altitude description
  const altDesc = m.altitude > 60 ? 'presque au-dessus de toi'
    : m.altitude > 40 ? 'haute dans le ciel'
    : m.altitude > 20 ? 'à mi-hauteur'
    : m.altitude > 5 ? 'assez basse sur l\'horizon'
    : 'au ras des toits';

  // --- Build description with IMMEDIATE surroundings ---
  let desc = '';

  if (moonStreet && nearPOIAligned) {
    // Best case: street + nearby place aligned with moon
    const side = nearPOI.moonAngleDiff > 0 ? 'droite' : 'gauche';
    if (nearPOI.moonAbsDiff < 8) {
      desc = `Si tu regardes vers ${moonStreet}, la Lune est juste au-dessus de ${nearPOI.name}, ${altDesc}.`;
    } else {
      desc = `Regarde dans la direction de ${moonStreet}. La Lune est légèrement à ${side} de ${nearPOI.name}, ${altDesc}.`;
    }
  } else if (moonStreet) {
    // Street reference only — give a usable instruction
    desc = `Tourne-toi vers ${moonStreet} et lève les yeux. La Lune est ${altDesc} dans cette direction.`;
  } else if (nearPOIAligned) {
    // POI reference only
    if (nearPOI.moonAbsDiff < 8) {
      desc = `La Lune est pile au-dessus de ${nearPOI.name}, ${altDesc}.`;
    } else {
      const side = nearPOI.moonAngleDiff > 0 ? 'droite' : 'gauche';
      desc = `Regarde vers ${nearPOI.name} et tourne légèrement à ${side}. La Lune est ${altDesc}.`;
    }
  } else {
    // Fallback: use any available reference
    const anyStreet = state.landmarks.find(l => l.isStreet);
    const anyPOI = state.landmarks.find(l => !l.isStreet && l.distance < 200);

    if (anyStreet) {
      const streetName = fmtStreetName(anyStreet.name);
      if (anyStreet.moonAbsDiff < 45) {
        desc = `Tourne-toi vers ${streetName} et lève les yeux. La Lune est ${altDesc}.`;
      } else if (anyStreet.moonAbsDiff > 135) {
        desc = `Tourne le dos à ${streetName}. La Lune est dans la direction opposée, ${altDesc}.`;
      } else {
        const streetSide = anyStreet.moonAngleDiff > 0 ? 'droite' : 'gauche';
        desc = `Depuis ${streetName}, tourne à ${streetSide}. La Lune est ${altDesc}.`;
      }
    } else if (anyPOI) {
      const side = anyPOI.moonAngleDiff > 0 ? 'droite' : 'gauche';
      desc = `Regarde vers ${anyPOI.name} puis tourne à ${side}. La Lune est ${altDesc}.`;
    } else {
      // Dernier recours : chercher n'importe quel repere physique
      const lastRef = findAnyPhysicalRef(m.azimuth);
      if (lastRef) {
        desc = `Tourne-toi vers ${lastRef} et lève les yeux. La Lune est ${altDesc}.`;
      } else {
        desc = `Lève les yeux, la Lune est ${altDesc}.`;
      }
    }
  }

  // Heading-aware bonus (if compass active, add body-relative hint)
  if (state.heading !== null) {
    let turn = m.azimuth - state.heading;
    while (turn > 180) turn -= 360;
    while (turn < -180) turn += 360;

    let bodyHint = '';
    if (Math.abs(turn) < 15) bodyHint = ' Elle est droit devant toi.';
    else if (Math.abs(turn) > 165) bodyHint = ' Elle est dans ton dos.';
    else if (turn > 0 && turn < 90) bodyHint = ' Tourne légèrement à droite.';
    else if (turn >= 90) bodyHint = ' Elle est derrière toi sur la droite.';
    else if (turn < 0 && turn > -90) bodyHint = ' Tourne légèrement à gauche.';
    else bodyHint = ' Elle est derrière toi sur la gauche.';
    desc += bodyHint;
  }

  // Weather context
  if (state.weatherCode > 0) {
    desc += ` ${getWeatherText(state.weatherCode)}.`;
  } else if (state.cloudCover !== null) {
    if (state.cloudCover > 80) desc += ` Ciel couvert (${Math.round(state.cloudCover)}%).`;
    else if (state.cloudCover > 50) desc += ` Nuages partiels.`;
  }

  return desc;
}

// Find the street name closest to a given azimuth
function findStreetInDirection(azimuth) {
  const streets = state.landmarks.filter(l => l.isStreet);
  if (!streets.length) return null;

  let best = null, bestDiff = 999;
  streets.forEach(s => {
    let diff = Math.abs(azimuth - s.bearing);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  });

  if (best && bestDiff < 30) return fmtStreetName(best.name);
  return null;
}

// Find ANY physical reference near a given azimuth (street, POI, shop — anything)
function findAnyPhysicalRef(azimuth) {
  if (!state.landmarks.length) return null;
  let best = null, bestDiff = 999;
  state.landmarks.forEach(lm => {
    let diff = Math.abs(azimuth - lm.bearing);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = lm; }
  });
  if (!best || bestDiff > 60) return null;
  return best.isStreet ? fmtStreetName(best.name) : best.name;
}

// Format street name: add article if needed
function fmtStreetName(name) {
  if (/^(rue|avenue|boulevard|place|passage|impasse|allée|quai|cours|chemin|square)/i.test(name)) {
    return name;
  }
  return 'la rue ' + name;
}

function findLandmarkNear(azimuth) {
  if (!state.landmarks.length) return null;
  let best = null, bestDiff = 999;
  state.landmarks.forEach(lm => {
    let diff = Math.abs(azimuth - lm.bearing);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = { ...lm, _diff: diff }; }
  });
  return best;
}

function calcMoonRiseAzimuth() {
  if (!state.moonData?.rise || typeof Astronomy === 'undefined') return null;
  try {
    const observer = new Astronomy.Observer(state.lat, state.lng, 0);
    const t = Astronomy.MakeTime(state.moonData.rise);
    const eq = Astronomy.Equator('Moon', t, observer, true, true);
    const hor = Astronomy.Horizon(t, observer, eq.ra, eq.dec, 'normal');
    return hor.azimuth;
  } catch (_) { return null; }
}

function lmDescription(lm) {
  if (!state.moonData?.isAboveHorizon) return 'Lune sous l\'horizon';
  const d = lm.moonAbsDiff;

  // Find a SECOND reference to orient the user relative to this landmark
  const orient = findOrientRef(lm);

  if (d < 5) {
    return orient
      ? `La Lune est dans cet axe (quand tu regardes vers ${orient})`
      : `La Lune est pile dans cette direction`;
  }

  const side = lm.moonAngleDiff > 0 ? 'droite' : 'gauche';

  if (d < 20) {
    return orient
      ? `Lune légèrement à ${side} quand tu regardes vers ${orient}`
      : `Lune légèrement à ${side}`;
  }
  if (d < 45) {
    return orient
      ? `Lune à ${side} quand tu fais face à ${orient}`
      : `Lune à ${side}`;
  }
  if (d > 135) return `Lune à l'opposé`;
  return orient ? `Lune vers ${orient}` : `Lune de l'autre côté`;
}

// Find a second landmark to orient the user: "quand tu regardes vers [X]"
function findOrientRef(lm) {
  // Look for another landmark near the moon's azimuth (not the same one)
  const moonAz = state.moonData.azimuth;
  const others = state.landmarks.filter(l => l.name !== lm.name);

  let best = null, bestDiff = 999;
  others.forEach(o => {
    let diff = Math.abs(moonAz - o.bearing);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = o; }
  });

  if (best && bestDiff < 30) {
    return best.isStreet ? fmtStreetName(best.name) : best.name;
  }
  return null;
}

// ============================
// COMPASS
// ============================
function setupCompassButton() {
  const btn = $('btn-compass');
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    btn.classList.remove('hidden');
    btn.addEventListener('click', async () => {
      try {
        const p = await DeviceOrientationEvent.requestPermission();
        if (p === 'granted') { startCompass(); btn.classList.add('hidden'); }
      } catch (_) {}
    });
  } else if ('DeviceOrientationEvent' in window) {
    startCompass();
  }
}

function startCompass() {
  $('compass-hint').textContent = 'Oriente ton téléphone pour suivre la Lune';
  window.addEventListener('deviceorientation', e => {
    let h = e.webkitCompassHeading !== undefined ? e.webkitCompassHeading
           : (e.alpha !== null && e.absolute) ? (360 - e.alpha) % 360 : null;
    if (h !== null) {
      if (state.heading === null) state.heading = h;
      else {
        let diff = h - state.heading;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        state.heading += diff * CONFIG.compassSmoothing;
        state.heading = ((state.heading % 360) + 360) % 360;
      }
      renderCompass();
    }
  }, true);
}

// ============================
// RENDERING
// ============================
function renderAll() {
  if (!state.moonData) return;
  const m = state.moonData;
  updateSky(); // refresh sky colors with latest cloud data

  const h = new Date().getHours();
  $('greeting').textContent = (h >= 5 && h < 18) ? 'Bonjour Agnès' : 'Bonsoir Agnès';
  $('location-name').textContent = state.locationName || '';

  renderMoonPhase();
  $('phase-name').textContent = getPhaseName(m.phaseAngle);
  $('illumination').textContent = `${Math.round(m.fraction * 100)}% illuminée`;
  $('main-description').textContent = generateMainDescription();
  renderVisibility();
  renderCompass();

  $('moonrise').textContent = formatTime(m.rise || m.risePast);
  $('moonset').textContent = formatTime(m.set || m.setPast);
  $('next-full').textContent = m.nextFull ? formatDate(m.nextFull) : '--';

  renderLandmarks();

  $('detail-altitude').textContent = m.isAboveHorizon ? `${m.altitude.toFixed(1)}°` : 'Sous l\'horizon';
  $('detail-azimuth').textContent = `${m.azimuth.toFixed(1)}° ${azToCardinal(m.azimuth)}`;
  $('detail-distance').textContent = m.distance ? `${Math.round(m.distance * 149597870.7).toLocaleString('fr-FR')} km` : '--';
  $('detail-clouds').textContent = state.cloudCover !== null ? `${Math.round(state.cloudCover)}%` : '--';
  $('detail-phase').textContent = `${m.phaseAngle.toFixed(0)}°`;
  $('detail-illum').textContent = `${Math.round(m.fraction * 100)}%`;
  $('last-update').textContent = `Mis à jour à ${formatTime(new Date())}`;
}

// Box blur on alpha channel only — Safari iOS fallback for canvas filter
function _boxBlurAlpha(ctx, w, h, radius) {
  if (radius < 1) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const len = w * h;
  const buf = new Uint8Array(len);
  // Extract alpha
  for (let i = 0; i < len; i++) buf[i] = d[i * 4 + 3];
  // Horizontal pass
  const tmp = new Uint8Array(len);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += buf[y * w + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = Math.round(sum / (radius * 2 + 1));
      const add = Math.min(w - 1, x + radius + 1);
      const rem = Math.max(0, x - radius);
      sum += buf[y * w + add] - buf[y * w + rem];
    }
  }
  // Vertical pass
  const out = new Uint8Array(len);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / (radius * 2 + 1));
      const add = Math.min(h - 1, y + radius + 1);
      const rem = Math.max(0, y - radius);
      sum += tmp[add * w + x] - tmp[rem * w + x];
    }
  }
  // Write back alpha (keep RGB white)
  for (let i = 0; i < len; i++) {
    d[i * 4] = 255; d[i * 4 + 1] = 255; d[i * 4 + 2] = 255;
    d[i * 4 + 3] = out[i];
  }
  ctx.putImageData(img, 0, 0);
}

// Sun altitude helper — used for moon tint and sky
function _getSunAltitude() {
  try {
    if (state.lat != null && state.lng != null && typeof Astronomy !== 'undefined') {
      const now = Astronomy.MakeTime(new Date());
      const observer = new Astronomy.Observer(state.lat, state.lng, 0);
      const sunEq = Astronomy.Equator('Sun', now, observer, true, true);
      const sunHor = Astronomy.Horizon(now, observer, sunEq.ra, sunEq.dec, 'normal');
      return sunHor.altitude;
    }
  } catch (_) {}
  // Fallback: rough estimate from hour
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  return 50 * Math.sin(((h - 6) / 12) * Math.PI);
}

// Moon photo — local file (512x512, 59KB, public domain Wikipedia/NASA)
let _moonImg = null;
let _moonImgLoaded = false;

(function loadMoonImage() {
  _moonImg = new Image();
  _moonImg.onload = () => { _moonImgLoaded = true; if (state.moonData) renderMoonPhase(); };
  _moonImg.onerror = () => { console.warn('Moon texture failed to load'); };
  _moonImg.src = 'moon-texture.jpg';
})();

function renderMoonPhase() {
  const canvas = $('moon-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 220;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2, r = 92;
  const frac = state.moonData.fraction;
  const tilt = (state.moonData.terminatorTilt || 0) * 0.35;
  const isWaxing = state.moonData.phaseAngle < 180;
  const tw = r * Math.abs(2 * frac - 1);
  const sunAlt = _getSunAltitude();

  ctx.clearRect(0, 0, size, size);

  // === APPROACH: alpha mask on separate canvas ===
  // 1. Build a white lit-side mask with blurred edge (on mask canvas)
  // 2. Draw moon photo on main offscreen canvas
  // 3. Apply mask via destination-in → clean soft terminator, no dark fringe

  // --- MASK CANVAS: white = visible, transparent = hidden ---
  const mask = document.createElement('canvas');
  mask.width = size * dpr; mask.height = size * dpr;
  const mc = mask.getContext('2d');
  mc.scale(dpr, dpr);

  // Draw the LIT side shape in white, with blur applied to the draw operation
  if (frac >= 0.995) {
    mc.fillStyle = '#fff';
    mc.beginPath(); mc.arc(cx, cy, r + 2, 0, Math.PI * 2); mc.fill();
  } else if (frac <= 0.005) {
    // New moon — nothing visible (leave mask empty)
  } else {
    // Draw lit shape on a temp canvas, then draw it blurred onto the mask
    const tmp = document.createElement('canvas');
    tmp.width = size * dpr; tmp.height = size * dpr;
    const tc = tmp.getContext('2d');
    tc.scale(dpr, dpr);
    tc.fillStyle = '#fff';
    tc.save();
    tc.translate(cx, cy);
    tc.rotate(tilt);
    tc.translate(-cx, -cy);
    tc.beginPath();
    if (isWaxing) {
      tc.arc(cx, cy, r + 2, -Math.PI / 2, Math.PI / 2, false);
      tc.ellipse(cx, cy, tw, r + 2, 0, Math.PI / 2, -Math.PI / 2, frac <= 0.5);
    } else {
      tc.arc(cx, cy, r + 2, Math.PI / 2, -Math.PI / 2, false);
      tc.ellipse(cx, cy, tw, r + 2, 0, -Math.PI / 2, Math.PI / 2, frac >= 0.5);
    }
    tc.closePath();
    tc.fill();
    tc.restore();

    // Blur the mask for soft terminator
    // Safari/WebKit doesn't actually apply canvas context filter even though it accepts the property
    // Detect by testing if blur actually changes pixel data
    const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
    const useManualBlur = isWebKit || typeof mc.filter === 'undefined';

    if (!useManualBlur) {
      try {
        mc.filter = 'blur(20px)';
        mc.drawImage(tmp, 0, 0, size * dpr, size * dpr, 0, 0, size, size);
        mc.filter = 'none';
      } catch (_) {
        // If filter fails, fall through to manual
        mc.drawImage(tmp, 0, 0, size * dpr, size * dpr, 0, 0, size, size);
        _boxBlurAlpha(mc, mask.width, mask.height, Math.round(12 * dpr));
      }
    } else {
      // Safari / iOS: manual box blur on alpha channel
      mc.drawImage(tmp, 0, 0, size * dpr, size * dpr, 0, 0, size, size);
      _boxBlurAlpha(mc, mask.width, mask.height, Math.round(12 * dpr));
    }
  }

  // --- MOON CANVAS ---
  const off = document.createElement('canvas');
  off.width = size * dpr; off.height = size * dpr;
  const oc = off.getContext('2d');
  oc.scale(dpr, dpr);

  // 1) Draw moon photo clipped to disc
  oc.save();
  oc.beginPath(); oc.arc(cx, cy, r - 0.5, 0, Math.PI * 2); oc.clip();
  try { oc.filter = 'blur(0.4px)'; } catch (_) {}
  if (_moonImgLoaded && _moonImg) {
    const s = Math.min(_moonImg.naturalWidth, _moonImg.naturalHeight);
    const sx = (_moonImg.naturalWidth - s) / 2;
    const sy = (_moonImg.naturalHeight - s) / 2;
    const pad = 18;
    oc.drawImage(_moonImg, sx, sy, s, s, cx - r - pad, cy - r - pad, (r + pad) * 2, (r + pad) * 2);
  } else {
    const g = oc.createRadialGradient(cx - r * 0.15, cy - r * 0.15, 0, cx, cy, r);
    g.addColorStop(0, '#c0c0bc'); g.addColorStop(0.6, '#a0a09c'); g.addColorStop(1, '#70706c');
    oc.fillStyle = g;
    oc.beginPath(); oc.arc(cx, cy, r, 0, Math.PI * 2); oc.fill();
  }
  oc.filter = 'none';

  // 2) Time-of-day tint
  if (sunAlt < -12) {
    oc.fillStyle = 'rgba(220,200,150,0.10)';
  } else if (sunAlt < 0) {
    oc.fillStyle = `rgba(215,195,145,${(0.10 - ((sunAlt + 12) / 12) * 0.04).toFixed(3)})`;
  } else {
    oc.fillStyle = 'rgba(230,235,245,0.15)';
  }
  oc.beginPath(); oc.arc(cx, cy, r, 0, Math.PI * 2); oc.fill();

  // 3) Subtle limb darkening
  const limb = oc.createRadialGradient(cx, cy, r * 0.6, cx, cy, r - 1);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(0.9, 'rgba(0,0,0,0)');
  limb.addColorStop(1, 'rgba(0,0,0,0.12)');
  oc.fillStyle = limb;
  oc.beginPath(); oc.arc(cx, cy, r, 0, Math.PI * 2); oc.fill();
  oc.restore();

  // 4) Apply alpha mask — destination-in keeps only where mask is white
  if (frac > 0.005 && frac < 0.995) {
    oc.save();
    oc.globalCompositeOperation = 'destination-in';
    oc.drawImage(mask, 0, 0, size * dpr, size * dpr, 0, 0, size, size);
    oc.globalCompositeOperation = 'source-over';
    oc.restore();
  }

  // 5) Lit-side glow behind (destination-over)
  if (frac > 0.01 && frac < 0.995) {
    oc.save();
    oc.globalCompositeOperation = 'destination-over';
    oc.translate(cx, cy);
    oc.rotate(tilt);
    const gx = isWaxing ? r * 0.15 : -r * 0.15;
    const gr = r * 1.25;
    const glow = oc.createRadialGradient(gx, 0, r * 0.5, gx, 0, gr);
    if (sunAlt < -6) {
      glow.addColorStop(0, 'rgba(220,200,160,0.10)');
      glow.addColorStop(1, 'rgba(220,200,160,0)');
    } else {
      glow.addColorStop(0, 'rgba(210,215,230,0.07)');
      glow.addColorStop(1, 'rgba(210,215,230,0)');
    }
    oc.fillStyle = glow;
    oc.beginPath(); oc.arc(0, 0, gr, 0, Math.PI * 2); oc.fill();
    oc.globalCompositeOperation = 'source-over';
    oc.restore();
  }

  // 6) Composite to main canvas
  ctx.drawImage(off, 0, 0, size * dpr, size * dpr, 0, 0, size, size);
}


function renderCompass() {
  const canvas = $('compass-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 300;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2, R = 130;
  const rot = state.heading !== null ? -state.heading * Math.PI / 180 : 0;
  const moonAz = state.moonData?.azimuth || 0;

  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);

  // Rings
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5; ctx.stroke();

  // Ticks
  for (let i = 0; i < 72; i++) {
    const a = i * 5 * Math.PI / 180 - Math.PI / 2;
    const isCar = i % 18 === 0, isMaj = i % 9 === 0;
    const inn = isCar ? R - 14 : isMaj ? R - 9 : R - 5;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * inn, Math.sin(a) * inn);
    ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    ctx.strokeStyle = isCar ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = isCar ? 2 : 1; ctx.stroke();
  }

  // Cardinals
  [{ l: 'N', d: 0 }, { l: 'E', d: 90 }, { l: 'S', d: 180 }, { l: 'O', d: 270 }].forEach(c => {
    const a = c.d * Math.PI / 180 - Math.PI / 2;
    ctx.save(); ctx.translate(Math.cos(a) * (R - 24), Math.sin(a) * (R - 24)); ctx.rotate(-rot);
    ctx.font = '600 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = c.l === 'N' ? '#c9a87c' : 'rgba(255,255,255,0.4)';
    ctx.fillText(c.l, 0, 0); ctx.restore();
  });

  // Landmark dots
  state.landmarks.slice(0, 10).forEach(lm => {
    const a = lm.bearing * Math.PI / 180 - Math.PI / 2;
    ctx.beginPath(); ctx.arc(Math.cos(a) * (R + 8), Math.sin(a) * (R + 8), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = lm.moonAbsDiff < 15 ? 'rgba(201,168,124,0.5)' : 'rgba(255,255,255,0.15)';
    ctx.fill();
  });

  // Moon indicator — photo with phase, tilt, and all
  if (state.moonData) {
    const ma = moonAz * Math.PI / 180 - Math.PI / 2;
    const mr = R - 50;
    const moonX = Math.cos(ma) * mr;
    const moonY = Math.sin(ma) * mr;
    const moonR = 18; // radius of mini moon on compass

    // Subtle glow behind
    const gg = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonR * 2);
    gg.addColorStop(0, 'rgba(201,168,124,0.2)');
    gg.addColorStop(1, 'rgba(201,168,124,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(moonX, moonY, moonR * 2, 0, Math.PI * 2); ctx.fill();

    // Line from center to moon
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ma) * (mr - moonR - 4), Math.sin(ma) * (mr - moonR - 4));
    ctx.strokeStyle = 'rgba(201,168,124,0.15)'; ctx.lineWidth = 1; ctx.stroke();

    // Draw mini moon with photo + phase
    ctx.save();
    ctx.translate(moonX, moonY);
    // Counter-rotate so moon stays upright regardless of compass rotation
    ctx.rotate(-rot);

    // Clip to mini moon circle
    ctx.beginPath(); ctx.arc(0, 0, moonR, 0, Math.PI * 2); ctx.clip();

    // Draw moon photo
    if (_moonImgLoaded && _moonImg) {
      const imgSz = Math.min(_moonImg.naturalWidth, _moonImg.naturalHeight);
      const isx = (_moonImg.naturalWidth - imgSz) / 2;
      const isy = (_moonImg.naturalHeight - imgSz) / 2;
      ctx.drawImage(_moonImg, isx, isy, imgSz, imgSz, -moonR, -moonR, moonR * 2, moonR * 2);
    } else {
      ctx.fillStyle = '#b0b0ac';
      ctx.beginPath(); ctx.arc(0, 0, moonR, 0, Math.PI * 2); ctx.fill();
    }

    // Phase shadow on mini moon
    const frac = state.moonData.fraction;
    const isWaxing = state.moonData.phaseAngle < 180;
    const tilt = state.moonData.terminatorTilt || 0;

    if (frac > 0.003 && frac < 0.995) {
      const tw = moonR * Math.abs(2 * frac - 1);
      ctx.save();
      ctx.rotate(tilt);

      ctx.beginPath();
      if (isWaxing) {
        ctx.arc(0, 0, moonR, -Math.PI / 2, Math.PI / 2, true);
        ctx.ellipse(0, 0, tw, moonR, 0, Math.PI / 2, -Math.PI / 2, frac > 0.5);
      } else {
        ctx.arc(0, 0, moonR, Math.PI / 2, -Math.PI / 2, true);
        ctx.ellipse(0, 0, tw, moonR, 0, -Math.PI / 2, Math.PI / 2, frac < 0.5);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(8,9,26,0.97)';
      ctx.fill();
      ctx.restore();
    } else if (frac <= 0.003) {
      ctx.fillStyle = 'rgba(6,6,14,0.92)';
      ctx.beginPath(); ctx.arc(0, 0, moonR, 0, Math.PI * 2); ctx.fill();
    }

    // Dim if below horizon
    if (!state.moonData.isAboveHorizon) {
      ctx.fillStyle = 'rgba(10,10,20,0.6)';
      ctx.beginPath(); ctx.arc(0, 0, moonR, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fillStyle = '#5aad7a'; ctx.fill();
}

function renderVisibility() {
  const badge = $('visibility-badge');
  if (!badge || state.cloudCover === null) { badge?.classList.add('hidden'); return; }
  badge.classList.remove('hidden');
  badge.className = 'visibility-badge';
  const wc = state.weatherCode ?? 0;
  const weatherLabel = getWeatherText(wc);

  if (wc >= 61 || wc === 67 || wc === 66) {
    // Rain, snow, storm — poor visibility
    badge.classList.add('cloudy');
    badge.textContent = `${weatherLabel} — Lune peu visible`;
  } else if (wc >= 45 || state.cloudCover >= 60) {
    // Fog, overcast, drizzle
    badge.classList.add('cloudy');
    badge.textContent = `${weatherLabel} — Lune peu visible`;
  } else if (state.cloudCover >= 30) {
    badge.classList.add('partial');
    badge.textContent = `${weatherLabel}`;
  } else {
    badge.classList.add('clear');
    badge.textContent = `${weatherLabel} — conditions idéales`;
  }
}

function renderLandmarks() {
  // Render on both compass tab AND home tab
  const targets = [
    { section: $('landmarks-section'), list: $('landmarks-list') },
    { section: $('home-landmarks'), list: $('home-landmarks-list') }
  ];

  const hasData = state.landmarks.length && state.moonData;

  targets.forEach(({ section, list }) => {
    if (!section || !list) return;
    if (!hasData) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');

    // Separate monuments/POIs from streets
    const pois = state.landmarks.filter(l => !l.isStreet).slice(0, 4);
    const streets = state.landmarks.filter(l => l.isStreet).slice(0, 3);
    const items = [...pois, ...streets].slice(0, 6);

    list.innerHTML = items.map(lm => {
      const icon = lm.isStreet ? '&#8594;' : lm.kind === 'edifice' ? '&#9963;' : lm.kind === 'parc' ? '&#9652;' : '&#9679;';
      return `<li class="landmark-item">
        <div class="landmark-dot ${lm.moonAbsDiff > 30 ? 'far' : ''}">${lm.isStreet ? '' : ''}</div>
        <div class="landmark-info">
          <div class="landmark-name">${esc(lm.name)}</div>
          <div class="landmark-desc">${lmDescription(lm)}</div>
        </div>
        <div class="landmark-distance">${fmtDist(lm.distance)}</div>
      </li>`;
    }).join('');
  });
}

// ============================
// SKY BACKGROUND — CSS driven, sun-altitude + weather
// Sky presets (5 gradient stops each) for every WMO weather condition,
// day AND night variants. Colors sampled from real sky photography.
// ============================
const SKY_PRESETS = {
  // === CLEAR ===
  dayClear:       { top: '#1a3a68', upper: '#2a5a8a', mid: '#3a7aaa', lower: '#62a0c4', bottom: '#8ac0d8' },
  nightClear:     { top: '#050810', upper: '#080e1a', mid: '#0c1428', lower: '#0e1830', bottom: '#121e38' },

  // === PARTLY CLOUDY (WMO 1-2) ===
  dayPartly:      { top: '#2a4a72', upper: '#3a6490', mid: '#5080a0', lower: '#6898b4', bottom: '#80aec4' },
  nightPartly:    { top: '#0a0e18', upper: '#10162a', mid: '#182238', lower: '#1e2a40', bottom: '#243248' },

  // === OVERCAST (WMO 3) ===
  dayOvercast:    { top: '#6a7280', upper: '#727a88', mid: '#7a8290', lower: '#848c98', bottom: '#8e96a2' },
  nightOvercast:  { top: '#141618', upper: '#1a1c20', mid: '#222428', lower: '#282a2e', bottom: '#2e3034' },

  // === FOG / MIST (WMO 45, 48) ===
  dayFog:         { top: '#888e96', upper: '#8e949c', mid: '#949aa2', lower: '#9aa0a8', bottom: '#a0a6ae' },
  nightFog:       { top: '#1e2024', upper: '#242628', mid: '#2a2c30', lower: '#303236', bottom: '#36383c' },

  // === DRIZZLE (WMO 51-57) ===
  dayDrizzle:     { top: '#606870', upper: '#687078', mid: '#707880', lower: '#7a8288', bottom: '#848c92' },
  nightDrizzle:   { top: '#121416', upper: '#181a1e', mid: '#1e2024', lower: '#24262a', bottom: '#2a2c30' },

  // === RAIN (WMO 61-67, 80-82) ===
  dayRain:        { top: '#4a525c', upper: '#525a64', mid: '#5a626c', lower: '#626a72', bottom: '#6a7278' },
  nightRain:      { top: '#0e1014', upper: '#141618', mid: '#1a1c1e', lower: '#202224', bottom: '#262828' },

  // === HEAVY RAIN (WMO 65, 82) ===
  dayHeavyRain:   { top: '#3a4248', upper: '#424a50', mid: '#4a5258', lower: '#525a60', bottom: '#5a6268' },
  nightHeavyRain: { top: '#0a0c0e', upper: '#101214', mid: '#161818', lower: '#1c1e1e', bottom: '#222424' },

  // === SNOW (WMO 71-77, 85-86) ===
  daySnow:        { top: '#78808a', upper: '#828a94', mid: '#8c949e', lower: '#969ea8', bottom: '#a0a8b2' },
  nightSnow:      { top: '#181c22', upper: '#1e2228', mid: '#24282e', lower: '#2a2e34', bottom: '#30343a' },

  // === THUNDERSTORM (WMO 95-99) ===
  dayStorm:       { top: '#2a3038', upper: '#323840', mid: '#3a4048', lower: '#424850', bottom: '#4a5058' },
  nightStorm:     { top: '#080a0c', upper: '#0e1012', mid: '#141618', lower: '#1a1c1e', bottom: '#202224' },

  // === TWILIGHT (sun near horizon) ===
  civilDawn:      { top: '#1a2a55', upper: '#282848', mid: '#3a2a50', lower: '#804838', bottom: '#c05838' },
  civilDusk:      { top: '#1a2040', upper: '#302040', mid: '#4a2248', lower: '#903838', bottom: '#b84828' },
  nautical:       { top: '#0a1228', upper: '#101830', mid: '#141e3a', lower: '#1a2840', bottom: '#1e2845' },
  lowSunAM:       { top: '#2a4a78', upper: '#325888', mid: '#3a6090', lower: '#5080a0', bottom: '#6a98b8' },
  lowSunPM:       { top: '#1e3868', upper: '#2a4070', mid: '#3a4a78', lower: '#685848', bottom: '#8a6858' }
};

function lerpColor(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return '#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1);
}

function lerpPreset(a, b, t) {
  return {
    top: lerpColor(a.top, b.top, t),
    upper: lerpColor(a.upper, b.upper, t),
    mid: lerpColor(a.mid, b.mid, t),
    lower: lerpColor(a.lower, b.lower, t),
    bottom: lerpColor(a.bottom, b.bottom, t)
  };
}

function desaturateColor(hex, amount) {
  // Shift color toward grey by `amount` (0-1)
  const h = parseInt(hex.slice(1), 16);
  const r = (h >> 16) & 0xff, g = (h >> 8) & 0xff, b = h & 0xff;
  const grey = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  const nr = Math.round(r + (grey - r) * amount);
  const ng = Math.round(g + (grey - g) * amount);
  const nb = Math.round(b + (grey - b) * amount);
  return '#' + ((1 << 24) + (nr << 16) + (ng << 8) + nb).toString(16).slice(1);
}

function updateSky() {
  const el = $('sky-bg');
  if (!el) return;

  const wc = state.weatherCode ?? 0;
  const cloud = state.cloudCover ?? 20;
  const cloudFactor = Math.min(1, cloud / 100);

  // Sun altitude
  let sunAlt;
  try {
    if (state.lat != null && state.lng != null && typeof Astronomy !== 'undefined') {
      const now = Astronomy.MakeTime(new Date());
      const observer = new Astronomy.Observer(state.lat, state.lng, 0);
      const sunEq = Astronomy.Equator('Sun', now, observer, true, true);
      const sunHor = Astronomy.Horizon(now, observer, sunEq.ra, sunEq.dec, 'normal');
      sunAlt = sunHor.altitude;
    }
  } catch (_) {}
  if (sunAlt == null) {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    sunAlt = 50 * Math.sin(((h - 6) / 12) * Math.PI);
  }

  // Map WMO weathercode to sky preset pair (day/night)
  let dayPreset, nightPreset;
  if (wc >= 95) {
    // Thunderstorm
    dayPreset = SKY_PRESETS.dayStorm;
    nightPreset = SKY_PRESETS.nightStorm;
  } else if (wc >= 71 || (wc >= 85 && wc <= 86) || wc === 77) {
    // Snow
    dayPreset = SKY_PRESETS.daySnow;
    nightPreset = SKY_PRESETS.nightSnow;
  } else if (wc === 65 || wc === 67 || wc === 82) {
    // Heavy rain
    dayPreset = SKY_PRESETS.dayHeavyRain;
    nightPreset = SKY_PRESETS.nightHeavyRain;
  } else if ((wc >= 61 && wc <= 67) || (wc >= 80 && wc <= 82)) {
    // Rain
    dayPreset = SKY_PRESETS.dayRain;
    nightPreset = SKY_PRESETS.nightRain;
  } else if (wc >= 51 && wc <= 57) {
    // Drizzle
    dayPreset = SKY_PRESETS.dayDrizzle;
    nightPreset = SKY_PRESETS.nightDrizzle;
  } else if (wc === 45 || wc === 48) {
    // Fog
    dayPreset = SKY_PRESETS.dayFog;
    nightPreset = SKY_PRESETS.nightFog;
  } else if (wc === 3 || cloudFactor > 0.7) {
    // Overcast
    dayPreset = SKY_PRESETS.dayOvercast;
    nightPreset = SKY_PRESETS.nightOvercast;
  } else if (wc >= 1 || cloudFactor > 0.3) {
    // Partly cloudy — blend between clear and partly
    const t = Math.min(1, cloudFactor / 0.7);
    dayPreset = lerpPreset(SKY_PRESETS.dayClear, SKY_PRESETS.dayPartly, t);
    nightPreset = lerpPreset(SKY_PRESETS.nightClear, SKY_PRESETS.nightPartly, t);
  } else {
    // Clear
    dayPreset = SKY_PRESETS.dayClear;
    nightPreset = SKY_PRESETS.nightClear;
  }

  // Determine final sky color based on sun altitude (continuous transition)
  let colors, starOpacity;
  const h = new Date().getHours();

  if (sunAlt > 20) {
    colors = dayPreset;
    starOpacity = 0;
  } else if (sunAlt > 6) {
    // Low sun → full day transition
    const t = (sunAlt - 6) / 14;
    const low = h < 14 ? SKY_PRESETS.lowSunAM : SKY_PRESETS.lowSunPM;
    colors = lerpPreset(low, dayPreset, t);
    starOpacity = 0;
  } else if (sunAlt > 0) {
    // Golden hour / civil twilight
    const t = sunAlt / 6;
    const civil = h < 14 ? SKY_PRESETS.civilDawn : SKY_PRESETS.civilDusk;
    const low = h < 14 ? SKY_PRESETS.lowSunAM : SKY_PRESETS.lowSunPM;
    colors = lerpPreset(civil, low, t);
    starOpacity = Math.max(0, (1 - t) * 0.15);
  } else if (sunAlt > -6) {
    // Civil twilight
    const t = (sunAlt + 6) / 6;
    const civil = h < 14 ? SKY_PRESETS.civilDawn : SKY_PRESETS.civilDusk;
    colors = lerpPreset(nightPreset, civil, t);
    starOpacity = (1 - t) * (wc < 3 ? 1 : 0.2);
  } else if (sunAlt > -12) {
    // Nautical twilight
    const t = (sunAlt + 12) / 6;
    colors = lerpPreset(nightPreset, SKY_PRESETS.nautical, t);
    starOpacity = (1 - t * 0.3) * (wc < 3 ? 1 : 0.1);
  } else {
    // Full night
    colors = nightPreset;
    starOpacity = wc < 3 ? 1 : (wc < 45 ? 0.3 : 0);
  }

  // Stars hidden by clouds/weather
  starOpacity = starOpacity * Math.max(0, 1 - cloudFactor * 0.9);

  // Apply gradient directly (CSS custom properties don't trigger gradient repaint in all browsers)
  el.style.background = `linear-gradient(to bottom, ${colors.top} 0%, ${colors.upper} 25%, ${colors.mid} 50%, ${colors.lower} 75%, ${colors.bottom} 100%)`;
  el.style.setProperty('--star-opacity', starOpacity.toFixed(3));
}

// ============================
// WEATHER EFFECTS — canvas-based rain, snow, hail particles
// Driven by WMO weather_code from Open-Meteo API
// ============================
const _weather = { particles: [], effect: 'none', intensity: 'light', animFrame: null };

function updateWeatherEffects() {
  const wc = state.weatherCode ?? 0;
  let effect = 'none', intensity = 'light';

  if (wc >= 96) { effect = 'hail'; intensity = wc === 99 ? 'heavy' : 'light'; }
  else if (wc >= 95) { effect = 'rain'; intensity = 'heavy'; }
  else if (wc >= 85 || (wc >= 71 && wc <= 77)) {
    effect = 'snow';
    intensity = (wc === 71 || wc === 85) ? 'light' : (wc === 73) ? 'moderate' : 'heavy';
  } else if ((wc >= 61 && wc <= 67) || (wc >= 80 && wc <= 82)) {
    effect = 'rain';
    intensity = (wc === 61 || wc === 66 || wc === 80) ? 'light' : (wc === 63 || wc === 81) ? 'moderate' : 'heavy';
  } else if (wc >= 51 && wc <= 57) {
    effect = 'rain'; intensity = 'drizzle';
  }

  if (effect !== _weather.effect || intensity !== _weather.intensity) {
    _weather.effect = effect;
    _weather.intensity = intensity;
    _weather.particles = [];
    _initWeatherParticles();
  }

  if (effect !== 'none' && !_weather.animFrame) _weatherLoop();
}

function _initWeatherParticles() {
  const w = window.innerWidth, h = window.innerHeight;
  const { effect, intensity } = _weather;
  if (effect === 'none') return;

  // Particle count based on effect + intensity
  const counts = {
    rain:  { drizzle: 40, light: 80, moderate: 150, heavy: 250 },
    snow:  { light: 50, moderate: 100, heavy: 180 },
    hail:  { light: 30, heavy: 60 }
  };
  const n = counts[effect]?.[intensity] ?? 80;

  for (let i = 0; i < n; i++) {
    const p = { x: Math.random() * w, y: Math.random() * h };
    if (effect === 'rain') {
      p.speed = intensity === 'drizzle' ? 4 + Math.random() * 3
              : intensity === 'heavy' ? 14 + Math.random() * 6
              : 8 + Math.random() * 5;
      p.len = intensity === 'drizzle' ? 8 + Math.random() * 6
            : intensity === 'heavy' ? 18 + Math.random() * 10
            : 12 + Math.random() * 8;
      p.opacity = 0.15 + Math.random() * 0.25;
      p.wind = 0.5 + Math.random() * 1.5; // slight wind drift
    } else if (effect === 'snow') {
      p.speed = 0.5 + Math.random() * 1.5;
      p.size = 1.5 + Math.random() * 2.5;
      p.opacity = 0.4 + Math.random() * 0.4;
      p.wobble = Math.random() * Math.PI * 2; // oscillation phase
      p.wobbleSpeed = 0.02 + Math.random() * 0.03;
      p.wobbleAmp = 0.3 + Math.random() * 0.7;
    } else if (effect === 'hail') {
      p.speed = 10 + Math.random() * 8;
      p.size = 2 + Math.random() * 2;
      p.opacity = 0.5 + Math.random() * 0.3;
      p.wind = 1 + Math.random() * 2;
    }
    _weather.particles.push(p);
  }
}

function _weatherLoop() {
  if (_weather.effect === 'none') { _weather.animFrame = null; return; }
  const canvas = $('weather-canvas');
  if (!canvas) { _weather.animFrame = null; return; }

  const w = window.innerWidth, h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const { effect, particles } = _weather;

  particles.forEach(p => {
    if (effect === 'rain') {
      // Vertical line falling down with slight wind angle
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.wind, p.y + p.len);
      ctx.strokeStyle = `rgba(180,200,220,${p.opacity})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      p.y += p.speed;
      p.x += p.wind * 0.3;
      if (p.y > h) { p.y = -p.len; p.x = Math.random() * w; }
    } else if (effect === 'snow') {
      // Dot that drifts down + oscillates horizontally
      p.wobble += p.wobbleSpeed;
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(p.wobble) * p.wobbleAmp * 20, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
      ctx.fill();
      p.y += p.speed;
      p.x += Math.sin(p.wobble) * p.wobbleAmp * 0.5;
      if (p.y > h + p.size) { p.y = -p.size; p.x = Math.random() * w; }
    } else if (effect === 'hail') {
      // Small hard dot falling fast with wind
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,215,230,${p.opacity})`;
      ctx.fill();
      // Short streak
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - p.size);
      ctx.lineTo(p.x + p.wind * 0.5, p.y - p.size - 5);
      ctx.strokeStyle = `rgba(200,215,230,${p.opacity * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      p.y += p.speed;
      p.x += p.wind * 0.4;
      if (p.y > h) { p.y = -10; p.x = Math.random() * w; }
    }
  });

  _weather.animFrame = requestAnimationFrame(_weatherLoop);
}

// Compat shim — drawSkyBackground alias used in startApp()
function drawSkyBackground() { updateSky(); }

// ============================
// NAVIGATION
// ============================
function switchTab(tabId) {
  // Stop AR camera when leaving camera tab
  if (state.currentTab === 'camera' && tabId !== 'camera' && typeof stopAR === 'function') stopAR();

  state.currentTab = tabId;
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  $(`tab-${tabId}`)?.classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tabId}"]`)?.classList.add('active');

  // Scroll to top
  $(`tab-${tabId}`)?.scrollTo?.(0, 0);
  window.scrollTo(0, 0);

  // Re-render compass when switching to it
  if (tabId === 'compass') renderCompass();
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(`screen-${name}`)?.classList.remove('hidden');
}

function showError(msg) {
  $('error-message').textContent = msg;
  showScreen('error');
}

function toggleNight() {
  state.nightMode = !state.nightMode;
  document.body.classList.toggle('night-mode', state.nightMode);
  $('btn-night').textContent = state.nightMode ? 'Mode normal' : 'Mode nuit';
}

// ============================
// UTILITIES
// ============================
function calcBearing(lat1, lng1, lat2, lng2) {
  const R = Math.PI / 180;
  const dL = (lng2 - lng1) * R;
  const y = Math.sin(dL) * Math.cos(lat2 * R);
  const x = Math.cos(lat1 * R) * Math.sin(lat2 * R) - Math.sin(lat1 * R) * Math.cos(lat2 * R) * Math.cos(dL);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const d1 = (lat2 - lat1) * r, d2 = (lng2 - lng1) * r;
  const a = Math.sin(d1 / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(d2 / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function azToCardinal(az) {
  return ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'][Math.round(az / 45) % 8];
}

function formatTime(d) {
  if (!d) return '--:--';
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(d) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function fmtDist(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`; }

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================
// AR CAMERA VIEW
// ============================
const ar = {
  active: false,
  stream: null,
  heading: null,      // compass heading (smoothed)
  headingRaw: null,   // raw compass heading
  pitch: null,        // camera look altitude in degrees (smoothed)
  pitchRaw: null,     // raw pitch
  beta: null,         // raw device beta
  animFrame: null,
  FOV_H: 55,          // iPhone rear camera ~55-60° horizontal FOV
  FOV_V: 75,          // ~75° vertical FOV in portrait
  SMOOTH: 0.2         // smoothing factor (lower = smoother, slower)
};

function initAR() {
  $('btn-ar-start')?.addEventListener('click', startAR);
}

async function startAR() {
  const video = $('ar-video');
  const btn = $('btn-ar-start');

  // Step 1: Request orientation permission FIRST (iOS requires user gesture)
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') {
        $('ar-status').textContent = 'Autorise l\'orientation dans les réglages Safari pour cette page.';
      }
    }
  } catch (e) {
    console.warn('Orientation permission:', e);
  }

  // Step 2: Request camera
  try {
    // Try rear camera first
    ar.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
  } catch (e1) {
    try {
      // Fallback: any camera
      ar.stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e2) {
      console.error('Camera error:', e2);
      $('ar-status').textContent = 'Autorise la caméra dans Safari > Réglages du site.';
      btn.textContent = 'Réessayer';
      btn.classList.remove('hidden');
      return;
    }
  }

  video.srcObject = ar.stream;
  await video.play().catch(() => {});
  btn.classList.add('hidden');

  // Step 3: Start orientation listener and calibrate
  window.addEventListener('deviceorientation', onAROrientation, true);

  // Calibration phase: collect samples for 2 seconds before going live
  $('ar-status').textContent = 'Calibrage... Tiens le téléphone droit devant toi.';
  $('ar-description').textContent = '';
  ar.calibrating = true;
  ar.calibSamples = [];

  setTimeout(() => {
    ar.calibrating = false;
    ar.active = true;
    renderARLoop();
  }, 2000);
}

function onAROrientation(e) {
  // --- Compass heading ---
  let rawHeading = null;
  if (e.webkitCompassHeading !== undefined) {
    rawHeading = e.webkitCompassHeading;
  } else if (e.alpha !== null && e.absolute) {
    rawHeading = (360 - e.alpha) % 360;
  }

  if (rawHeading !== null) {
    ar.headingRaw = rawHeading;
    if (ar.heading === null) {
      ar.heading = rawHeading;
    } else {
      // Smooth heading (handle 0/360 wraparound)
      let diff = rawHeading - ar.heading;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;
      ar.heading += diff * ar.SMOOTH;
      ar.heading = ((ar.heading % 360) + 360) % 360;
    }
  }

  // --- Phone tilt → camera look altitude ---
  // beta: 0=flat face up, 90=vertical, 180=flat face down
  // Camera altitude = beta - 90:
  //   beta=0 → cam looks at -90° (straight down)
  //   beta=90 → cam looks at 0° (horizon)
  //   beta=120 → cam looks at +30° (above horizon)
  //   beta=180 → cam looks at +90° (straight up)
  if (e.beta !== null) {
    ar.beta = e.beta;
    const rawPitch = e.beta - 90; // degrees: negative=below horizon, positive=above

    if (ar.pitch === null) {
      ar.pitch = rawPitch;
    } else {
      ar.pitch += (rawPitch - ar.pitch) * ar.SMOOTH;
    }
  }
}

function renderARLoop() {
  if (!ar.active) return;
  renderAROverlay();
  ar.animFrame = requestAnimationFrame(renderARLoop);
}

function renderAROverlay() {
  const canvas = $('ar-overlay');
  if (!canvas || !state.moonData) return;

  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const w = rect.width, h = rect.height;
  const m = state.moonData;

  if (ar.heading === null || ar.pitch === null) {
    $('ar-status').textContent = 'Calibrage de la boussole... Fais un 8 avec ton téléphone.';
    return;
  }

  // --- Horizontal: difference between phone heading and moon azimuth ---
  let azDiff = m.azimuth - ar.heading;
  while (azDiff > 180) azDiff -= 360;
  while (azDiff < -180) azDiff += 360;

  // --- Vertical: phone camera altitude vs moon altitude ---
  // ar.pitch is already in degrees: negative=below horizon, positive=above
  let altDiff = m.altitude - ar.pitch;

  // --- Convert angular differences to screen pixels ---
  // FOV maps to screen dimensions
  const moonX = w / 2 + (azDiff / ar.FOV_H) * w;
  const moonY = h / 2 - (altDiff / ar.FOV_V) * h;

  // Check if moon is on screen
  const onScreen = moonX > -50 && moonX < w + 50 && moonY > -50 && moonY < h + 50;

  if (onScreen && m.isAboveHorizon) {
    // Draw moon indicator
    const moonR = 28;

    // Glow
    const glow = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 3);
    glow.addColorStop(0, 'rgba(201,168,124,0.3)');
    glow.addColorStop(1, 'rgba(201,168,124,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 3, 0, Math.PI * 2);
    ctx.fill();

    // Ring
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(201,168,124,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner dot
    ctx.beginPath();
    ctx.arc(moonX, moonY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#c9a87c';
    ctx.fill();

    // Label
    ctx.font = '600 14px system-ui';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText('Lune', moonX, moonY - moonR - 12);
    ctx.font = '400 11px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${Math.round(m.altitude)}° au-dessus de l'horizon`, moonX, moonY + moonR + 18);
    ctx.shadowBlur = 0;

    $('ar-status').textContent = 'La Lune est là !';
    $('ar-description').textContent = `${getPhaseName(m.phaseAngle)} — ${Math.round(m.fraction * 100)}% illuminée`;
  } else {
    // Moon is off-screen — draw arrow pointing TOWARD the moon
    const arrowSize = 32;
    const edgePad = 60;

    // Angle from screen center to moon position (where it actually is)
    const toMoonAngle = Math.atan2(moonY - h / 2, moonX - w / 2);

    // Place arrow on screen edge in the direction of the moon
    // Use ellipse equation to find intersection with screen edge
    const rx = w / 2 - edgePad, ry = h / 2 - edgePad;
    const scale = Math.min(
      Math.abs(rx / Math.cos(toMoonAngle)) || Infinity,
      Math.abs(ry / Math.sin(toMoonAngle)) || Infinity
    );
    const ax = w / 2 + Math.cos(toMoonAngle) * Math.min(scale, Math.max(rx, ry));
    const ay = h / 2 + Math.sin(toMoonAngle) * Math.min(scale, Math.max(rx, ry));

    // Clamp to safe area
    const safeAx = Math.max(edgePad, Math.min(w - edgePad, ax));
    const safeAy = Math.max(edgePad, Math.min(h - edgePad, ay));

    ctx.save();
    ctx.translate(safeAx, safeAy);
    // Rotate so arrow tip points toward the moon
    // Arrow drawn pointing UP (negative Y), so rotate by toMoonAngle - PI/2
    ctx.rotate(toMoonAngle - Math.PI / 2);

    // Glow
    ctx.shadowColor = 'rgba(201,168,124,0.5)';
    ctx.shadowBlur = 16;

    // Pulsing opacity (subtle)
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 400);

    // Outer chevron
    ctx.globalAlpha = pulse * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize * 1.4);
    ctx.lineTo(arrowSize * 0.85, arrowSize * 0.3);
    ctx.lineTo(0, -arrowSize * 0.1);
    ctx.lineTo(-arrowSize * 0.85, arrowSize * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#c9a87c';
    ctx.fill();

    // Inner chevron
    ctx.globalAlpha = pulse * 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize);
    ctx.lineTo(arrowSize * 0.55, arrowSize * 0.15);
    ctx.lineTo(0, -arrowSize * 0.2);
    ctx.lineTo(-arrowSize * 0.55, arrowSize * 0.15);
    ctx.closePath();
    ctx.fillStyle = '#c9a87c';
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = pulse * 0.7;
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.fillStyle = '#c9a87c';
    ctx.textAlign = 'center';
    ctx.fillText('LUNE', 0, arrowSize * 0.75);
    ctx.globalAlpha = 1;

    ctx.restore();

    // Direction hint — combine horizontal and vertical
    let hints = [];
    if (Math.abs(azDiff) > 20) {
      const deg = Math.round(Math.abs(azDiff));
      hints.push(azDiff > 0 ? `Tourne à droite (${deg}°)` : `Tourne à gauche (${deg}°)`);
    }
    if (altDiff > 15) {
      hints.push(`Lève le téléphone (${Math.round(altDiff)}° plus haut)`);
    } else if (altDiff < -15) {
      hints.push(`Baisse le téléphone (${Math.round(Math.abs(altDiff))}° plus bas)`);
    }

    if (!m.isAboveHorizon) {
      hints = ['La Lune est sous l\'horizon'];
    } else if (hints.length === 0) {
      hints.push('Presque... encore un peu');
    }

    $('ar-status').textContent = hints[0];
    const extra = hints.length > 1 ? hints.slice(1).join(' — ') : `Lune : ${azToCardinal(m.azimuth)}, ${Math.round(m.altitude)}° d'altitude`;
    $('ar-description').textContent = extra;
  }

  // Crosshair center
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 20, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function stopAR() {
  ar.active = false;
  if (ar.stream) {
    ar.stream.getTracks().forEach(t => t.stop());
    ar.stream = null;
  }
  if (ar.animFrame) cancelAnimationFrame(ar.animFrame);
  window.removeEventListener('deviceorientation', onAROrientation, true);
}

// Init AR button listener on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initAR);

// ============================
// PUSH NOTIFICATIONS
// ============================

const VAPID_PUBLIC_KEY = 'BPblSpfMWkRcnITlHzMph5wpW15AN9JgHiVFnv4nQWPwC-cDlBU9-BpKgP-rvLnCaYSJDZfsDGiU1_vgtS47X1s';
const PUSH_API_URL = 'https://moon-push.mickael-tsakiris.workers.dev'; // Deployed

function showNotificationBanner() {
  // ?reset-push in URL clears push state for testing
  if (location.search.includes('reset-push')) {
    localStorage.removeItem('push-subscribed');
    localStorage.removeItem('push-dismissed');
  }
  if (localStorage.getItem('push-subscribed') === 'true') return;
  if (localStorage.getItem('push-dismissed') === 'true') return;

  const pushSupported = ('PushManager' in window) && ('Notification' in window);

  // If push not supported at all, show install hint
  if (!pushSupported) {
    const isInstalled = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isInstalled) {
      const banner = document.createElement('div');
      banner.id = 'notif-banner';
      banner.style.cssText = `
        position:fixed;bottom:92px;left:1rem;right:1rem;z-index:9998;
        background:rgba(30,40,80,0.95);color:#fff;text-align:center;
        padding:1rem;border-radius:16px;backdrop-filter:blur(12px);
        font-size:0.85rem;box-shadow:0 4px 24px rgba(0,0,0,0.4);
      `;
      banner.innerHTML = `
        <div style="margin-bottom:0.6rem">Pour recevoir les alertes Lune, ajoute l'app sur ton écran d'accueil.</div>
        <div style="font-size:0.75rem;color:rgba(255,255,255,0.5)">Safari → Partager → Sur l'écran d'accueil</div>
        <button id="btn-notif-no" style="
          background:transparent;color:rgba(255,255,255,0.5);border:none;
          padding:0.5rem 1rem;font-size:0.8rem;cursor:pointer;margin-top:0.5rem;
        ">OK, compris</button>
      `;
      document.body.appendChild(banner);
      $('btn-notif-no')?.addEventListener('click', () => banner.remove());
    }
    return;
  }

  if (Notification.permission === 'denied') return;

  const banner = document.createElement('div');
  banner.id = 'notif-banner';
  banner.style.cssText = `
    position:fixed;bottom:80px;left:1rem;right:1rem;z-index:9998;
    background:rgba(30,40,80,0.95);color:#fff;text-align:center;
    padding:1rem;border-radius:16px;backdrop-filter:blur(12px);
    font-size:0.85rem;box-shadow:0 4px 24px rgba(0,0,0,0.4);
  `;
  banner.innerHTML = `
    <div style="margin-bottom:0.6rem">Recevoir une alerte quand la Lune est visible le soir ?</div>
    <button id="btn-notif-yes" style="
      background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);
      padding:0.5rem 1.5rem;border-radius:10px;font-size:0.85rem;cursor:pointer;margin-right:0.5rem;
    ">Activer</button>
    <button id="btn-notif-no" style="
      background:transparent;color:rgba(255,255,255,0.5);border:none;
      padding:0.5rem 1rem;font-size:0.8rem;cursor:pointer;
    ">Plus tard</button>
  `;
  document.body.appendChild(banner);

  $('btn-notif-yes')?.addEventListener('click', async () => {
    banner.innerHTML = '<div style="padding:0.5rem">Activation en cours...</div>';
    try {
      await subscribeToPush();
      banner.innerHTML = '<div style="padding:0.5rem;color:#8f8">Notifications activées !</div>';
      setTimeout(() => banner.remove(), 2000);
    } catch (e) {
      banner.innerHTML = `<div style="padding:0.5rem;color:#f88">Erreur : ${e.message}</div>`;
      console.error('Push subscription error:', e);
      setTimeout(() => banner.remove(), 4000);
    }
  });
  $('btn-notif-no')?.addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('push-dismissed', 'true');
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  const status = (msg) => {
    const b = $('notif-banner');
    if (b) b.innerHTML = `<div style="padding:0.5rem;font-size:0.8rem">${msg}</div>`;
  };

  if (!('PushManager' in window)) throw new Error('PushManager absent');
  if (!('serviceWorker' in navigator)) throw new Error('ServiceWorker absent');
  if (!('Notification' in window)) throw new Error('Notification API absente');

  if (localStorage.getItem('push-subscribed') === 'true') return;

  status('Demande de permission...');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permission: ' + permission);

  status('Attente du Service Worker...');
  // Force re-register SW if needed, with timeout
  let reg;
  try {
    reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SW ready timeout')), 5000))
    ]);
  } catch (_) {
    status('Re-enregistrement du Service Worker...');
    reg = await navigator.serviceWorker.register('./sw.js');
    // Wait for it to activate
    await new Promise(resolve => {
      if (reg.active) return resolve();
      const sw = reg.installing || reg.waiting;
      if (sw) sw.addEventListener('statechange', () => { if (sw.state === 'activated') resolve(); });
      setTimeout(resolve, 3000); // fallback
    });
    reg = await navigator.serviceWorker.ready;
  }

  status('Vérification abonnement existant...');
  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    status('Création de l\'abonnement push...');
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

    // Timeout de 10s car pushManager.subscribe peut bloquer sur iOS
    subscription = await Promise.race([
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout — pushManager.subscribe bloqué (10s)')), 10000)
      )
    ]);
  }

  status('Envoi au serveur...');
  const resp = await fetch(PUSH_API_URL + '/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON())
  });

  if (resp.ok) {
    localStorage.setItem('push-subscribed', 'true');
  } else {
    throw new Error('Serveur: ' + resp.status);
  }
}
