/* ============================
   Moon Tracker Agnès — v4
   ============================ */

const CONFIG = {
  landmarkRadius: 2000,
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
  cloudCover: null, nightMode: false, updateTimer: null,
  currentTab: 'home'
};

const $ = id => document.getElementById(id);
const sky = { stars: [], clouds: [], animId: null, w: 0, h: 0, time: 0 };

// ============================
// INIT
// ============================
document.addEventListener('DOMContentLoaded', () => {
  // Start animated sky IMMEDIATELY, independently of everything else
  try { initSkyBackground(); } catch (e) { console.error('Sky init error:', e); }

  $('btn-start')?.addEventListener('click', startApp);
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
  const distanceM = 100; // 100m — visible from your window
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
  const r = CONFIG.landmarkRadius;
  const query = `[out:json][timeout:8];(
    node["tourism"="attraction"](around:${r},${state.lat},${state.lng});
    node["tourism"="museum"](around:${r},${state.lat},${state.lng});
    node["historic"="monument"](around:${r},${state.lat},${state.lng});
    node["amenity"="place_of_worship"](around:${r},${state.lat},${state.lng});
    node["railway"="station"](around:${r},${state.lat},${state.lng});
    node["leisure"="park"]["name"](around:${r},${state.lat},${state.lng});
  );out 15;`;

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
      kind: el.tags.railway ? 'station' : el.tags.leisure ? 'parc' : el.tags.amenity ? 'edifice' : el.tags.tourism || 'monument',
      isStreet: false,
      isPark: el.tags.leisure === 'park',
      lat: el.lat,
      lng: el.lon,
      bearing: calcBearing(state.lat, state.lng, el.lat, el.lon),
      distance: haversine(state.lat, state.lng, el.lat, el.lon)
    }));
}

// Nearby shops, cafes, pharmacies — within 250m (what you can see/walk to)
async function fetchOverpassNearby() {
  const r = 250;
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
    `${CONFIG.openMeteoApi}?latitude=${state.lat}&longitude=${state.lng}&hourly=cloud_cover&timezone=auto&forecast_days=1`
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  const h = data.hourly;
  if (!h?.cloud_cover) return null;
  return h.cloud_cover[new Date().getHours()] ?? null;
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
    const streetRef = findStreetInDirection(calcMoonRiseAzimuth() || m.azimuth);
    if (m.rise && m.rise > new Date()) {
      let desc = `La Lune est sous l'horizon. Elle apparaîtra à ${formatTime(m.rise)}`;
      desc += streetRef ? `, côté ${streetRef}` : `, direction ${dir}`;
      desc += '.';
      if (state.cloudCover !== null && state.cloudCover > 70)
        desc += ` Ciel couvert à ${Math.round(state.cloudCover)}%.`;
      return desc;
    }
    return 'La Lune se repose sous l\'horizon. Prochain lever demain.';
  }

  // --- Moon above horizon ---
  // Find the closest STREET in the moon's direction (most useful reference)
  const moonStreet = findStreetInDirection(m.azimuth);
  // Find nearest POI (shop, cafe, etc.) aligned with moon
  const nearPOI = state.landmarks
    .filter(l => !l.isStreet && l.distance < 300)
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
    const anyPOI = state.landmarks.find(l => !l.isStreet && l.distance < 500);

    if (anyStreet) {
      const streetName = fmtStreetName(anyStreet.name);
      if (anyStreet.moonAbsDiff < 45) {
        desc = `Tourne-toi vers ${streetName} et lève les yeux. La Lune est ${altDesc}.`;
      } else if (anyStreet.moonAbsDiff > 135) {
        desc = `Tourne le dos à ${streetName}. La Lune est dans la direction opposée, ${altDesc}.`;
      } else {
        const streetSide = anyStreet.moonAngleDiff > 0 ? 'droite' : 'gauche';
        desc = `Depuis ${streetName}, tourne à ${streetSide} direction ${dir}. La Lune est ${altDesc}.`;
      }
    } else if (anyPOI) {
      const side = anyPOI.moonAngleDiff > 0 ? 'droite' : 'gauche';
      desc = `Regarde vers ${anyPOI.name} puis tourne à ${side}. La Lune est ${altDesc}, direction ${dir}.`;
    } else {
      desc = `Regarde vers le ${dir} et lève les yeux. La Lune est ${altDesc}.`;
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

  // Cloud context
  if (state.cloudCover !== null) {
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
  const moonDir = azToCardinal(state.moonData.azimuth);

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
      : `Lune légèrement à ${side} (direction ${moonDir})`;
  }
  if (d < 45) {
    return orient
      ? `Lune à ${side} quand tu fais face à ${orient}`
      : `Lune à ${side} (direction ${moonDir})`;
  }
  if (d > 135) return `Lune à l'opposé (direction ${moonDir})`;
  return `Lune direction ${moonDir}`;
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
  state.compassAvailable = true;
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

  const cx = size / 2, cy = size / 2, r = 90;
  const { phaseAngle, terminatorTilt } = state.moonData;
  const frac = state.moonData.fraction;
  const tilt = terminatorTilt || 0; // rotation angle in radians
  ctx.clearRect(0, 0, size, size);

  const isWaxing = phaseAngle < 180;

  // --- Outer glow (soft halo) ---
  const glow = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.6);
  glow.addColorStop(0, `rgba(200,210,230,${0.06 * frac})`);
  glow.addColorStop(0.5, `rgba(180,190,210,${0.025 * frac})`);
  glow.addColorStop(1, 'rgba(180,190,210,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // --- Moon disc clip ---
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();

  // --- Full moon photo first (entire disc) ---
  if (_moonImgLoaded && _moonImg) {
    const imgSize = Math.min(_moonImg.naturalWidth, _moonImg.naturalHeight);
    const sx = (_moonImg.naturalWidth - imgSize) / 2;
    const sy = (_moonImg.naturalHeight - imgSize) / 2;
    ctx.drawImage(_moonImg, sx, sy, imgSize, imgSize, cx - r, cy - r, r * 2, r * 2);
  } else {
    const fb = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    fb.addColorStop(0, '#c8c8c4');
    fb.addColorStop(0.5, '#b0b0ac');
    fb.addColorStop(1, '#888884');
    ctx.fillStyle = fb;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // --- Limb darkening on full photo ---
  const limb = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(0.65, 'rgba(0,0,0,0)');
  limb.addColorStop(0.82, 'rgba(0,0,0,0.08)');
  limb.addColorStop(0.93, 'rgba(0,0,0,0.22)');
  limb.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = limb;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  // --- Phase shadow (dark side) with TILT ---
  if (frac < 0.995 && frac > 0.003) {
    const tw = r * Math.abs(2 * frac - 1);

    // Rotate around center for terminator tilt
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.translate(-cx, -cy);

    // Build the SHADOW path (dark area)
    ctx.beginPath();
    if (isWaxing) {
      // Waxing: LEFT side is dark
      // Left semicircle (dark limb)
      ctx.arc(cx, cy, r, Math.PI / 2, -Math.PI / 2, true);
      // Terminator back to close the shadow
      ctx.ellipse(cx, cy, tw, r, 0, -Math.PI / 2, Math.PI / 2, frac > 0.5);
    } else {
      // Waning: RIGHT side is dark
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.ellipse(cx, cy, tw, r, 0, Math.PI / 2, -Math.PI / 2, frac > 0.5);
    }
    ctx.closePath();

    // Shadow: graduated, not flat — photo slightly visible through (earthshine)
    const shadowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    shadowGrad.addColorStop(0, 'rgba(8,8,18,0.88)');
    shadowGrad.addColorStop(0.5, 'rgba(6,6,14,0.91)');
    shadowGrad.addColorStop(0.85, 'rgba(4,4,10,0.94)');
    shadowGrad.addColorStop(1, 'rgba(2,2,6,0.96)');
    ctx.fillStyle = shadowGrad;
    ctx.fill();

    // Soft terminator edge — penumbra gradient along the boundary
    const penW = r * 0.05;
    const termCenter = isWaxing ? cx + tw : cx - tw;
    const penDir = isWaxing ? 1 : -1;
    const pg = ctx.createLinearGradient(
      termCenter - penW * penDir, cy,
      termCenter + penW * 2 * penDir, cy
    );
    pg.addColorStop(0, 'rgba(6,6,14,0.6)');
    pg.addColorStop(0.4, 'rgba(6,6,14,0.25)');
    pg.addColorStop(1, 'rgba(6,6,14,0)');
    ctx.fillStyle = pg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    ctx.restore(); // pop tilt rotation
  } else if (frac <= 0.003) {
    // New moon — full shadow
    const nm = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    nm.addColorStop(0, 'rgba(8,8,18,0.92)');
    nm.addColorStop(1, 'rgba(2,2,6,0.97)');
    ctx.fillStyle = nm;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  ctx.restore(); // pop moon disc clip

  // Subtle outer rim
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(200,210,225,${0.03 * Math.min(1, frac * 3)})`;
  ctx.lineWidth = 0.5; ctx.stroke();
}

function _buildMoonTexture_REMOVED() { /* replaced by NASA photo */ }
function _buildMoonTexture_OLD(size, dpr, cx, cy, r, phaseAngle, lightDirX) {
  const tex = document.createElement('canvas');
  tex.width = size * dpr; tex.height = size * dpr;
  const tc = tex.getContext('2d');
  tc.scale(dpr, dpr);

  // Light angle for shading (0 = right, PI = left)
  const lightAngle = lightDirX > 0 ? 0 : Math.PI;
  const lx = Math.cos(lightAngle);
  const ly = -0.3; // slightly from above

  // Base moon color — realistic lunar grey (NOT warm cream)
  // Offset highlight toward the light source
  const hlX = cx + lightDirX * r * 0.15;
  const hlY = cy - r * 0.1;
  const baseGrad = tc.createRadialGradient(hlX, hlY, 0, cx, cy, r);
  baseGrad.addColorStop(0, '#c8c8c8'); // bright lunar grey
  baseGrad.addColorStop(0.3, '#b8b8b5');
  baseGrad.addColorStop(0.6, '#a0a09c');
  baseGrad.addColorStop(0.85, '#888884');
  baseGrad.addColorStop(1, '#686864');
  tc.beginPath(); tc.arc(cx, cy, r, 0, Math.PI * 2);
  tc.fillStyle = baseGrad; tc.fill();

  // Directional shading — subtle darkening on the side away from light
  const shadeGrad = tc.createLinearGradient(
    cx + lightDirX * r, cy, cx - lightDirX * r, cy
  );
  shadeGrad.addColorStop(0, 'rgba(0,0,0,0)');
  shadeGrad.addColorStop(0.4, 'rgba(0,0,0,0)');
  shadeGrad.addColorStop(1, 'rgba(0,0,0,0.15)');
  tc.fillStyle = shadeGrad;
  tc.beginPath(); tc.arc(cx, cy, r, 0, Math.PI * 2); tc.fill();

  // Maria (dark plains) — realistic positioning matching lunar nearside
  // Coordinates approximate the actual visible lunar maria as seen from Earth
  // Note: in standard moon orientation, Mare Imbrium is upper-left, etc.
  const maria = [
    // Oceanus Procellarum (large, western/left)
    { x: 0.22, y: -0.05, rx: 0.28, ry: 0.45, a: 0.20, rot: -0.15 },
    // Mare Imbrium (upper left)
    { x: 0.12, y: -0.28, rx: 0.25, ry: 0.22, a: 0.22, rot: 0 },
    // Mare Serenitatis (upper center-right)
    { x: -0.12, y: -0.22, rx: 0.16, ry: 0.15, a: 0.20, rot: 0.1 },
    // Mare Tranquillitatis (center-right)
    { x: -0.18, y: -0.02, rx: 0.20, ry: 0.16, a: 0.18, rot: 0.2 },
    // Mare Crisium (far right, isolated)
    { x: -0.42, y: -0.18, rx: 0.10, ry: 0.08, a: 0.22, rot: 0 },
    // Mare Fecunditatis (lower right)
    { x: -0.22, y: 0.15, rx: 0.14, ry: 0.12, a: 0.15, rot: -0.1 },
    // Mare Nectaris (small, lower right)
    { x: -0.15, y: 0.22, rx: 0.08, ry: 0.07, a: 0.14, rot: 0 },
    // Mare Humorum (lower left)
    { x: 0.22, y: 0.28, rx: 0.10, ry: 0.09, a: 0.16, rot: 0 },
    // Mare Nubium (lower center)
    { x: 0.05, y: 0.25, rx: 0.16, ry: 0.10, a: 0.12, rot: 0.1 },
    // Mare Frigoris (thin strip, northern)
    { x: 0.0, y: -0.42, rx: 0.30, ry: 0.05, a: 0.10, rot: 0.05 },
    // Mare Vaporum (small, center)
    { x: -0.02, y: -0.10, rx: 0.07, ry: 0.06, a: 0.12, rot: 0 },
  ];
  maria.forEach(m => {
    const mx = cx + m.x * r, my = cy + m.y * r;
    // Each mare is multiple overlapping blobs for organic edges
    for (let layer = 0; layer < 3; layer++) {
      const offX = (layer - 1) * m.rx * r * 0.15;
      const offY = (layer - 1) * m.ry * r * 0.1;
      const scl = 1 - layer * 0.12;
      const mg = tc.createRadialGradient(
        mx + offX, my + offY, 0,
        mx + offX, my + offY, Math.max(m.rx, m.ry) * r * scl
      );
      const alpha = m.a * (1 - layer * 0.2);
      mg.addColorStop(0, `rgba(65,63,58,${alpha})`);
      mg.addColorStop(0.6, `rgba(72,68,62,${alpha * 0.6})`);
      mg.addColorStop(1, 'rgba(72,68,62,0)');
      tc.fillStyle = mg;
      tc.save();
      tc.translate(mx + offX, my + offY);
      tc.rotate(m.rot);
      tc.beginPath();
      tc.ellipse(0, 0, m.rx * r * scl, m.ry * r * scl, 0, 0, Math.PI * 2);
      tc.fill();
      tc.restore();
    }
  });

  // Highland brightness (slightly brighter patches in the southern hemisphere)
  const highlands = [
    { x: -0.05, y: 0.40, r: 0.20, a: 0.06 },
    { x: 0.20, y: 0.42, r: 0.15, a: 0.05 },
    { x: -0.30, y: 0.35, r: 0.12, a: 0.04 },
    { x: 0.10, y: -0.38, r: 0.10, a: 0.04 },
  ];
  highlands.forEach(h => {
    const hg = tc.createRadialGradient(
      cx + h.x * r, cy + h.y * r, 0,
      cx + h.x * r, cy + h.y * r, h.r * r
    );
    hg.addColorStop(0, `rgba(210,208,200,${h.a})`);
    hg.addColorStop(1, 'rgba(210,208,200,0)');
    tc.fillStyle = hg;
    tc.beginPath();
    tc.arc(cx + h.x * r, cy + h.y * r, h.r * r, 0, Math.PI * 2);
    tc.fill();
  });

  // Craters — 35 craters with phase-aware shadow/highlight
  const craters = [
    // Major named craters (approximate real positions)
    { x: -0.08, y: 0.58, r: 0.08, name: 'Tycho', rays: true },
    { x: -0.38, y: -0.30, r: 0.06, name: 'Proclus' },
    { x: 0.02, y: -0.52, r: 0.06, name: 'Plato' },
    { x: -0.12, y: 0.38, r: 0.05, name: 'Ptolemaeus' },
    { x: -0.10, y: 0.30, r: 0.04, name: 'Alphonsus' },
    { x: -0.08, y: 0.24, r: 0.035, name: 'Arzachel' },
    { x: 0.32, y: 0.35, r: 0.05, name: 'Gassendi' },
    { x: -0.02, y: -0.08, r: 0.04, name: 'Manilius' },
    { x: 0.18, y: -0.48, r: 0.05, name: 'Archimedes' },
    { x: 0.38, y: -0.20, r: 0.04, name: 'Aristarchus' },
    { x: -0.30, y: -0.15, r: 0.04, name: 'Plinius' },
    // Copernicus (prominent with rays)
    { x: 0.12, y: 0.08, r: 0.06, name: 'Copernicus', rays: true },
    { x: 0.30, y: -0.40, r: 0.04, name: 'Timocharis' },
    { x: -0.22, y: 0.08, r: 0.035 },
    { x: 0.15, y: 0.30, r: 0.03 },
    { x: -0.35, y: 0.20, r: 0.04 },
    { x: 0.40, y: 0.10, r: 0.03 },
    { x: -0.28, y: -0.40, r: 0.035 },
    { x: 0.05, y: 0.45, r: 0.03 },
    { x: -0.42, y: 0.05, r: 0.03 },
    { x: 0.25, y: -0.15, r: 0.025 },
    { x: -0.18, y: -0.35, r: 0.03 },
    { x: 0.08, y: -0.30, r: 0.025 },
    { x: -0.32, y: 0.42, r: 0.035 },
    { x: 0.35, y: -0.05, r: 0.025 },
    { x: -0.05, y: 0.50, r: 0.03 },
    { x: 0.20, y: 0.45, r: 0.025 },
    { x: -0.40, y: -0.10, r: 0.02 },
    { x: 0.10, y: -0.15, r: 0.02 },
    { x: -0.15, y: 0.15, r: 0.02 },
    { x: 0.28, y: 0.22, r: 0.02 },
    { x: -0.25, y: -0.25, r: 0.02 },
    { x: 0.42, y: -0.30, r: 0.02 },
    { x: -0.08, y: -0.45, r: 0.025 },
    { x: 0.05, y: 0.12, r: 0.018 },
  ];

  craters.forEach(c => {
    const crx = cx + c.x * r, cry = cy + c.y * r, crr = c.r * r;
    // Check if within disc
    const dist = Math.sqrt((crx - cx) ** 2 + (cry - cy) ** 2);
    if (dist + crr > r * 0.95) return;

    // Shadow offset based on light direction
    const shadowOff = crr * 0.3;
    const shX = -lightDirX * shadowOff;
    const shY = shadowOff * 0.3;

    // Crater rim shadow (on the side away from light)
    tc.beginPath(); tc.arc(crx + shX, cry + shY, crr, 0, Math.PI * 2);
    tc.fillStyle = `rgba(35,33,28,${0.18 + c.r * 0.8})`;
    tc.fill();

    // Crater floor (slightly darker than surroundings)
    tc.beginPath(); tc.arc(crx, cry, crr * 0.85, 0, Math.PI * 2);
    tc.fillStyle = `rgba(95,92,85,${0.12 + c.r * 0.5})`;
    tc.fill();

    // Lit rim (on the side facing the light)
    tc.beginPath();
    tc.arc(crx - shX * 0.5, cry - shY * 0.5, crr * 0.9, 0, Math.PI * 2);
    tc.strokeStyle = `rgba(200,198,190,${0.08 + c.r * 0.6})`;
    tc.lineWidth = Math.max(0.5, crr * 0.15);
    tc.stroke();

    // Central peak for larger craters
    if (c.r > 0.04) {
      tc.beginPath();
      tc.arc(crx, cry, crr * 0.2, 0, Math.PI * 2);
      tc.fillStyle = 'rgba(180,178,170,0.08)';
      tc.fill();
    }

    // Bright ray system for Tycho and Copernicus
    if (c.rays) {
      tc.save();
      tc.globalCompositeOperation = 'screen';
      const rayCount = c.name === 'Tycho' ? 12 : 8;
      for (let i = 0; i < rayCount; i++) {
        const angle = (i / rayCount) * Math.PI * 2 + (c.x * 0.5);
        const rayLen = crr * (3 + Math.random() * 3);
        const rayW = crr * (0.15 + Math.random() * 0.1);
        tc.beginPath();
        tc.moveTo(crx + Math.cos(angle) * crr, cry + Math.sin(angle) * crr);
        tc.lineTo(
          crx + Math.cos(angle) * rayLen + Math.cos(angle + 0.3) * rayW,
          cry + Math.sin(angle) * rayLen + Math.sin(angle + 0.3) * rayW
        );
        tc.lineTo(
          crx + Math.cos(angle) * rayLen + Math.cos(angle - 0.3) * rayW,
          cry + Math.sin(angle) * rayLen + Math.sin(angle - 0.3) * rayW
        );
        tc.closePath();
        tc.fillStyle = 'rgba(180,178,172,0.04)';
        tc.fill();
      }
      tc.restore();
    }
  });

  // Dense surface micro-texture (granular noise)
  tc.globalCompositeOperation = 'overlay';
  const noiseCount = 1200;
  for (let i = 0; i < noiseCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * r;
    const nx = cx + Math.cos(angle) * dist;
    const ny = cy + Math.sin(angle) * dist;
    const sz = Math.random() * 1.2 + 0.2;
    const bright = Math.random();
    tc.beginPath(); tc.arc(nx, ny, sz, 0, Math.PI * 2);
    if (bright > 0.6) {
      tc.fillStyle = `rgba(255,255,250,${0.015 + Math.random() * 0.02})`;
    } else {
      tc.fillStyle = `rgba(0,0,0,${0.015 + Math.random() * 0.025})`;
    }
    tc.fill();
  }
  tc.globalCompositeOperation = 'source-over';

  // Pronounced limb darkening
  const limb = tc.createRadialGradient(cx + lightDirX * r * 0.05, cy - r * 0.05, r * 0.3, cx, cy, r);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(0.6, 'rgba(0,0,0,0)');
  limb.addColorStop(0.8, 'rgba(0,0,0,0.10)');
  limb.addColorStop(0.92, 'rgba(0,0,0,0.25)');
  limb.addColorStop(1, 'rgba(0,0,0,0.45)');
  tc.fillStyle = limb;
  tc.beginPath(); tc.arc(cx, cy, r, 0, Math.PI * 2); tc.fill();

  return tex;
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
        ctx.arc(0, 0, moonR, Math.PI / 2, -Math.PI / 2, true);
        ctx.ellipse(0, 0, tw, moonR, 0, -Math.PI / 2, Math.PI / 2, frac > 0.5);
      } else {
        ctx.arc(0, 0, moonR, -Math.PI / 2, Math.PI / 2, true);
        ctx.ellipse(0, 0, tw, moonR, 0, Math.PI / 2, -Math.PI / 2, frac > 0.5);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(6,6,14,0.92)';
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
  if (state.cloudCover < 30) { badge.classList.add('clear'); badge.textContent = 'Ciel dégagé — conditions idéales'; }
  else if (state.cloudCover < 60) { badge.classList.add('partial'); badge.textContent = `Partiellement couvert (${Math.round(state.cloudCover)}%)`; }
  else { badge.classList.add('cloudy'); badge.textContent = `Ciel couvert (${Math.round(state.cloudCover)}%) — Lune peu visible`; }
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
// ANIMATED SKY BACKGROUND
// ============================

function initSkyBackground() {
  const canvas = $('stars');
  if (!canvas) return;
  sky.w = canvas.width = window.innerWidth;
  sky.h = canvas.height = window.innerHeight;

  // Generate stars with realistic variety (seeded for consistency)
  sky.stars = [];
  let seed = 42;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // Regular dim stars (majority)
  for (let i = 0; i < 200; i++) {
    const brightness = r();
    sky.stars.push({
      x: r(), y: r(),
      size: r() * 1.0 + 0.2,
      baseAlpha: r() * 0.4 + 0.08,
      twinkleSpeed: r() * 0.003 + 0.001,
      twinklePhase: r() * Math.PI * 2,
      // Color temperature variation: most white, some warm, some blue
      colorR: 240 + Math.round(r() * 15),
      colorG: 240 + Math.round(r() * 15 - 8),
      colorB: 245 + Math.round(r() * 10),
      isBright: false
    });
  }
  // Bright prominent stars (few, with diffraction spikes)
  for (let i = 0; i < 12; i++) {
    const isWarm = r() > 0.6; // some warm-toned bright stars
    sky.stars.push({
      x: r(), y: r() * 0.7, // keep bright stars away from very bottom
      size: r() * 1.8 + 1.5,
      baseAlpha: r() * 0.3 + 0.5,
      twinkleSpeed: r() * 0.005 + 0.002,
      twinklePhase: r() * Math.PI * 2,
      colorR: isWarm ? 255 : 220 + Math.round(r() * 20),
      colorG: isWarm ? 230 + Math.round(r() * 15) : 235 + Math.round(r() * 20),
      colorB: isWarm ? 200 + Math.round(r() * 20) : 255,
      isBright: true,
      spikeAngle: r() * Math.PI // random orientation for diffraction
    });
  }

  // Generate realistic clouds (each cloud = cluster of blobs)
  sky.clouds = [];
  for (let i = 0; i < 10; i++) {
    const baseW = r() * 250 + 120;
    const baseH = r() * 50 + 25;
    // Generate 5-8 sub-blobs per cloud for fluffy organic shape
    const blobCount = Math.floor(r() * 4) + 5;
    const blobs = [];
    for (let b = 0; b < blobCount; b++) {
      blobs.push({
        offX: (r() - 0.5) * baseW * 0.8,
        offY: (r() - 0.5) * baseH * 1.2,
        rx: r() * baseW * 0.35 + baseW * 0.15,
        ry: r() * baseH * 0.4 + baseH * 0.2,
        alphaScale: 0.5 + r() * 0.5
      });
    }
    sky.clouds.push({
      x: r() * 1.6 - 0.3,
      y: r() * 0.55 + 0.05,
      w: baseW, h: baseH,
      speed: (r() * 0.00003 + 0.000008) * (r() > 0.5 ? 1 : 0.6),
      alpha: r() * 0.10 + 0.03,
      blobs
    });
  }

  window.addEventListener('resize', () => {
    sky.w = canvas.width = window.innerWidth;
    sky.h = canvas.height = window.innerHeight;
  });

  animateSky();
}

function animateSky() {
  const canvas = $('stars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = sky.w, h = sky.h;
  sky.time++;

  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const timeF = hour + min / 60;
  const cloud = state.cloudCover ?? 20;

  ctx.clearRect(0, 0, w, h);

  // ---- Multi-layer sky gradient (photorealistic atmospheric colors) ----
  const grad = ctx.createLinearGradient(0, 0, 0, h);

  if (timeF >= 21.5 || timeF < 4.5) {
    // Deep night — navy with subtle purple atmospheric tone
    grad.addColorStop(0, '#04070e');
    grad.addColorStop(0.2, '#070c18');
    grad.addColorStop(0.5, '#0a1020');
    grad.addColorStop(0.8, '#0d1428');
    grad.addColorStop(1, '#111830');
  } else if (timeF >= 4.5 && timeF < 6) {
    // Early dawn — deep blue zenith, first colors at horizon
    const t = (timeF - 4.5) / 1.5;
    grad.addColorStop(0, lerpColor('#04070e', '#0c1228', t));
    grad.addColorStop(0.3, lerpColor('#070c18', '#141e3a', t));
    grad.addColorStop(0.55, lerpColor('#0a1020', '#1e1a35', t));
    grad.addColorStop(0.75, lerpColor('#0d1428', '#3a1e2e', t));
    grad.addColorStop(0.9, lerpColor('#111830', '#6e3020', t));
    grad.addColorStop(1, lerpColor('#111830', '#8a4518', t));
  } else if (timeF >= 6 && timeF < 7.5) {
    // Dawn / golden hour — orange-pink horizon, deep blue above
    const t = (timeF - 6) / 1.5;
    grad.addColorStop(0, lerpColor('#0c1228', '#152848', t));
    grad.addColorStop(0.3, lerpColor('#141e3a', '#1e3555', t));
    grad.addColorStop(0.55, lerpColor('#1e1a35', '#2a3555', t));
    grad.addColorStop(0.75, lerpColor('#3a1e2e', '#3a4060', t));
    grad.addColorStop(0.9, lerpColor('#6e3020', '#405068', t));
    grad.addColorStop(1, lerpColor('#8a4518', '#354558', t));
  } else if (timeF >= 7.5 && timeF < 9.5) {
    // Morning transition to day
    const t = (timeF - 7.5) / 2;
    grad.addColorStop(0, lerpColor('#152848', '#142540', t));
    grad.addColorStop(0.4, lerpColor('#1e3555', '#1a3050', t));
    grad.addColorStop(0.7, lerpColor('#2a3555', '#1e3555', t));
    grad.addColorStop(1, lerpColor('#354558', '#182c48', t));
  } else if (timeF >= 9.5 && timeF < 16.5) {
    // Daytime — deep muted blue (not bright, this is a dark-themed app)
    if (cloud > 70) {
      grad.addColorStop(0, '#1e2a3a');
      grad.addColorStop(0.4, '#253545');
      grad.addColorStop(0.7, '#2a3a4a');
      grad.addColorStop(1, '#222e3c');
    } else {
      grad.addColorStop(0, '#122035');
      grad.addColorStop(0.3, '#18304a');
      grad.addColorStop(0.6, '#1a3350');
      grad.addColorStop(1, '#142840');
    }
  } else if (timeF >= 16.5 && timeF < 18.5) {
    // Sunset — warm horizon, blue zenith transitioning to deep blue
    const t = (timeF - 16.5) / 2;
    grad.addColorStop(0, lerpColor('#122035', '#0e1425', t));
    grad.addColorStop(0.3, lerpColor('#18304a', '#161835', t));
    grad.addColorStop(0.55, lerpColor('#1a3350', '#281828', t));
    grad.addColorStop(0.75, lerpColor('#142840', '#4a2020', t));
    grad.addColorStop(0.9, lerpColor('#142840', '#703018', t));
    grad.addColorStop(1, lerpColor('#142840', '#884015', t));
  } else if (timeF >= 18.5 && timeF < 20) {
    // Dusk — rapid darkening, last warm colors at horizon
    const t = (timeF - 18.5) / 1.5;
    grad.addColorStop(0, lerpColor('#0e1425', '#05080f', t));
    grad.addColorStop(0.3, lerpColor('#161835', '#08101c', t));
    grad.addColorStop(0.55, lerpColor('#281828', '#0c1220', t));
    grad.addColorStop(0.75, lerpColor('#4a2020', '#121828', t));
    grad.addColorStop(0.9, lerpColor('#703018', '#141c30', t));
    grad.addColorStop(1, lerpColor('#884015', '#121830', t));
  } else {
    // Late dusk (20-21.5) — fading to night
    const t = (timeF - 20) / 1.5;
    grad.addColorStop(0, lerpColor('#05080f', '#04070e', t));
    grad.addColorStop(0.3, lerpColor('#08101c', '#070c18', t));
    grad.addColorStop(0.6, lerpColor('#0c1220', '#0a1020', t));
    grad.addColorStop(1, lerpColor('#121830', '#111830', t));
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // ---- Atmospheric haze near horizon (lighter band at bottom) ----
  const hazeAlpha = (timeF >= 21 || timeF < 5) ? 0.04 : 0.06;
  const haze = ctx.createLinearGradient(0, h * 0.7, 0, h);
  haze.addColorStop(0, 'rgba(100,110,130,0)');
  haze.addColorStop(0.5, `rgba(80,90,110,${hazeAlpha * 0.4})`);
  haze.addColorStop(1, `rgba(70,80,100,${hazeAlpha})`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, h);

  // ---- Stars (night/twilight) ----
  const isStarry = timeF >= 18.5 || timeF < 7;
  if (isStarry) {
    const starVisibility = Math.max(0, 1 - cloud / 100);
    let nightDepth;
    if (timeF >= 21 || timeF < 5) nightDepth = 1;
    else if (timeF >= 18.5 && timeF < 21) nightDepth = (timeF - 18.5) / 2.5;
    else nightDepth = (7 - timeF) / 2;
    const globalAlpha = starVisibility * Math.min(1, nightDepth);

    sky.stars.forEach(s => {
      const twinkle = Math.sin(sky.time * s.twinkleSpeed + s.twinklePhase) * 0.3;
      const a = (s.baseAlpha + twinkle) * globalAlpha;
      if (a < 0.015) return;
      const sa = Math.max(0, Math.min(1, a));
      const sx = s.x * w, sy = s.y * h;

      if (s.isBright && sa > 0.2) {
        // Bright star with subtle glow and diffraction spikes
        // Soft glow halo
        const glowR = s.size * 4;
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        sg.addColorStop(0, `rgba(${s.colorR},${s.colorG},${s.colorB},${sa * 0.15})`);
        sg.addColorStop(0.3, `rgba(${s.colorR},${s.colorG},${s.colorB},${sa * 0.05})`);
        sg.addColorStop(1, `rgba(${s.colorR},${s.colorG},${s.colorB},0)`);
        ctx.fillStyle = sg;
        ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);

        // Cross-shaped diffraction spikes (subtle)
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(s.spikeAngle);
        ctx.strokeStyle = `rgba(${s.colorR},${s.colorG},${s.colorB},${sa * 0.12})`;
        ctx.lineWidth = 0.5;
        const spikeLen = s.size * 5;
        ctx.beginPath(); ctx.moveTo(-spikeLen, 0); ctx.lineTo(spikeLen, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -spikeLen); ctx.lineTo(0, spikeLen); ctx.stroke();
        ctx.restore();

        // Core
        ctx.beginPath(); ctx.arc(sx, sy, s.size * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.colorR},${s.colorG},${s.colorB},${sa})`;
        ctx.fill();
      } else {
        // Regular small star
        ctx.beginPath(); ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.colorR},${s.colorG},${s.colorB},${sa})`;
        ctx.fill();
      }
    });
  }

  // ---- Moon glow in sky (diffuse light at approximate moon position) ----
  if (state.moonData && state.moonData.isAboveHorizon && state.moonData.fraction > 0.05) {
    const moonFrac = state.moonData.fraction;
    const moonAlt = state.moonData.altitude;
    // Map altitude (0-90) to vertical position (bottom to top)
    const moonSkyY = h * (1 - Math.min(1, moonAlt / 70));
    const moonGlowAlpha = Math.min(0.06, moonFrac * 0.06) * (isStarry ? 1 : 0.3);
    const moonGlowR = 120 + moonFrac * 80;
    const mg = ctx.createRadialGradient(w * 0.5, moonSkyY, 0, w * 0.5, moonSkyY, moonGlowR);
    mg.addColorStop(0, `rgba(180,190,210,${moonGlowAlpha})`);
    mg.addColorStop(0.4, `rgba(150,160,180,${moonGlowAlpha * 0.4})`);
    mg.addColorStop(1, 'rgba(150,160,180,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, w, h);
  }

  // ---- Realistic clouds (multi-blob clusters) ----
  if (cloud > 10) {
    const numVisible = Math.min(sky.clouds.length, Math.ceil((cloud / 100) * sky.clouds.length) + 1);
    const nightMult = isStarry ? 0.5 : 1;
    // Cloud color shifts: night = dark grey-blue, day = lighter grey
    const cR = isStarry ? 90 : 150;
    const cG = isStarry ? 100 : 160;
    const cB = isStarry ? 120 : 178;

    sky.clouds.slice(0, numVisible).forEach(c => {
      c.x += c.speed;
      if (c.x > 1.4) c.x = -0.4;

      const baseCX = c.x * w;
      const baseCY = c.y * h;
      const cloudAlpha = c.alpha * (cloud / 100) * nightMult;

      // Draw each sub-blob in the cloud cluster
      c.blobs.forEach(blob => {
        const bx = baseCX + blob.offX;
        const by = baseCY + blob.offY;
        const ba = cloudAlpha * blob.alphaScale;

        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(blob.rx, blob.ry));
        bg.addColorStop(0, `rgba(${cR},${cG},${cB},${ba})`);
        bg.addColorStop(0.4, `rgba(${cR},${cG},${cB},${ba * 0.6})`);
        bg.addColorStop(0.7, `rgba(${cR},${cG},${cB},${ba * 0.2})`);
        bg.addColorStop(1, `rgba(${cR},${cG},${cB},0)`);
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.ellipse(bx, by, blob.rx, blob.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      // Soft edge glow to unify the cluster
      const unifyG = ctx.createRadialGradient(baseCX, baseCY, 0, baseCX, baseCY, c.w * 0.6);
      unifyG.addColorStop(0, `rgba(${cR},${cG},${cB},${cloudAlpha * 0.3})`);
      unifyG.addColorStop(0.6, `rgba(${cR},${cG},${cB},${cloudAlpha * 0.1})`);
      unifyG.addColorStop(1, `rgba(${cR},${cG},${cB},0)`);
      ctx.fillStyle = unifyG;
      ctx.beginPath();
      ctx.ellipse(baseCX, baseCY, c.w * 0.6, c.h * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---- Sun glow at horizon (dawn/dusk atmospheric scattering) ----
  if (timeF >= 5 && timeF < 20.5 && cloud < 85) {
    let sunY, sunAlpha, sunR, sunG, sunB;
    if (timeF < 7.5) {
      // Dawn glow — warm orange-pink
      sunY = h * (1.1 - (timeF - 5) / 5);
      sunAlpha = 0.10 * (1 - Math.abs(timeF - 6) / 2);
      sunR = 255; sunG = 180; sunB = 100;
    } else if (timeF > 17) {
      // Sunset glow — deep orange-red
      sunY = h * (0.6 + (timeF - 17) / 8);
      sunAlpha = 0.12 * (1 - Math.abs(timeF - 18.5) / 2.5);
      sunR = 255; sunG = 140; sunB = 60;
    } else {
      // Midday — very subtle warm wash
      sunY = h * 0.1;
      sunAlpha = 0.02;
      sunR = 255; sunG = 230; sunB = 180;
    }
    sunAlpha = Math.max(0, sunAlpha);

    if (sunAlpha > 0.005) {
      const sg = ctx.createRadialGradient(w * 0.5, sunY, 0, w * 0.5, sunY, 300);
      sg.addColorStop(0, `rgba(${sunR},${sunG},${sunB},${sunAlpha})`);
      sg.addColorStop(0.3, `rgba(${sunR},${sunG},${sunB},${sunAlpha * 0.4})`);
      sg.addColorStop(0.6, `rgba(${sunR},${sunG},${sunB},${sunAlpha * 0.1})`);
      sg.addColorStop(1, `rgba(${sunR},${sunG},${sunB},0)`);
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, h);

      // Secondary wider warm band for dawn/dusk
      if (sunAlpha > 0.03) {
        const band = ctx.createLinearGradient(0, sunY - 100, 0, sunY + 200);
        band.addColorStop(0, `rgba(${sunR},${sunG + 30},${sunB + 40},0)`);
        band.addColorStop(0.4, `rgba(${sunR},${sunG},${sunB},${sunAlpha * 0.15})`);
        band.addColorStop(1, `rgba(${sunR},${sunG},${sunB},0)`);
        ctx.fillStyle = band;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  sky.animId = requestAnimationFrame(animateSky);
}

function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return '#' + ((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1);
}

// Replace old drawSkyBackground calls
function drawSkyBackground() {
  if (!sky.animId) initSkyBackground();
}

// ============================
// NAVIGATION
// ============================
function switchTab(tabId) {
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
    // Moon is off-screen — draw arrow pointing to it
    const arrowSize = 20;
    const margin = 40;

    // Direction arrow
    const angle = Math.atan2(
      -(moonY - h / 2),
      moonX - w / 2
    );

    // Clamp arrow to screen edge
    const edgeX = Math.max(margin, Math.min(w - margin, moonX));
    const edgeY = Math.max(margin, Math.min(h - margin, moonY));
    const ax = moonX < 0 ? margin : moonX > w ? w - margin : edgeX;
    const ay = moonY < 0 ? margin : moonY > h ? h - margin : edgeY;

    // Arrow
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-angle + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize);
    ctx.lineTo(arrowSize * 0.6, arrowSize * 0.5);
    ctx.lineTo(-arrowSize * 0.6, arrowSize * 0.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(201,168,124,0.8)';
    ctx.fill();
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

// Init AR when tab switches
const origSwitchTab = switchTab;
switchTab = function(tabId) {
  // Stop AR when leaving camera tab
  if (state.currentTab === 'camera' && tabId !== 'camera') stopAR();
  origSwitchTab(tabId);
};

// Init AR button listener on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initAR);
