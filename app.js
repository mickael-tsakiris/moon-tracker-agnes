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
    // Step 1: Get position (fast fallback if blocked)
    let usingFallback = false;
    try {
      const pos = await getLocation();
      state.lat = pos.coords.latitude;
      state.lng = pos.coords.longitude;
    } catch (_) {
      state.lat = 48.8835;
      state.lng = 2.3219;
      usingFallback = true;
    }

    // Step 2: Calculate moon INSTANTLY (offline, no network) and show UI
    calculateMoon();
    if (usingFallback) state.locationName = 'Paris 17e (position approximative)';
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

  state.moonData = {
    azimuth: hor.azimuth,
    altitude: hor.altitude,
    distance: eq.dist,
    phaseAngle,
    phase: phaseAngle / 360,
    fraction: illum.phase_fraction,
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
    // Best case: we have both a street and a nearby place aligned with moon
    desc = `Regarde côté ${moonStreet}`;
    const side = nearPOI.moonAngleDiff > 0 ? 'droite' : 'gauche';
    if (nearPOI.moonAbsDiff < 8) {
      desc += `, au-dessus de ${nearPOI.name}`;
    } else {
      desc += `, légèrement à ${side} de ${nearPOI.name}`;
    }
    desc += `. La Lune est ${altDesc}.`;
  } else if (moonStreet) {
    // Street reference only
    desc = `Mets-toi face côté ${moonStreet}. La Lune est ${altDesc} dans cette direction.`;
  } else if (nearPOIAligned) {
    // POI reference only
    if (nearPOI.moonAbsDiff < 8) {
      desc = `La Lune est juste au-dessus de ${nearPOI.name}, ${altDesc}.`;
    } else {
      const side = nearPOI.moonAngleDiff > 0 ? 'droite' : 'gauche';
      desc = `Fais face à ${nearPOI.name}, la Lune est sur ta ${side}, ${altDesc}.`;
    }
  } else {
    // Fallback: use any available reference
    const anyStreet = state.landmarks.find(l => l.isStreet);
    const anyPOI = state.landmarks.find(l => !l.isStreet && l.distance < 500);

    if (anyStreet) {
      const streetSide = anyStreet.moonAngleDiff > 0 ? 'droite' : 'gauche';
      const streetName = fmtStreetName(anyStreet.name);
      if (anyStreet.moonAbsDiff < 45) {
        desc = `Regarde vers ${streetName}. La Lune est dans cette direction, ${altDesc}.`;
      } else if (anyStreet.moonAbsDiff > 135) {
        desc = `Tourne le dos à ${streetName}. La Lune est de l'autre côté, ${altDesc}.`;
      } else {
        desc = `Depuis ${streetName}, tourne à ${streetSide}. La Lune est direction ${dir}, ${altDesc}.`;
      }
    } else if (anyPOI) {
      const side = anyPOI.moonAngleDiff > 0 ? 'droite' : 'gauche';
      desc = `Depuis ${anyPOI.name}, regarde à ${side}. La Lune est direction ${dir}, ${altDesc}.`;
    } else {
      desc = `La Lune est direction ${dir}, ${altDesc}. Les repères arrivent...`;
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

function renderMoonPhase() {
  const canvas = $('moon-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 180;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2, r = 70;
  const { phase, phaseAngle } = state.moonData;
  ctx.clearRect(0, 0, size, size);

  // Glow
  const glow = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.6);
  glow.addColorStop(0, 'rgba(201,168,124,0.06)');
  glow.addColorStop(1, 'rgba(201,168,124,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Dark body
  const dg = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
  dg.addColorStop(0, '#252540');
  dg.addColorStop(1, '#12122a');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = dg; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1; ctx.stroke();

  // Use actual illumination fraction (0→1) instead of phaseAngle for accurate rendering
  const frac = state.moonData.fraction; // 0 = new moon, 1 = full moon

  if (frac < 0.01) return; // New moon — all dark
  if (frac > 0.99) {
    // Full moon — all lit
    const lg = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 0, cx, cy, r);
    lg.addColorStop(0, '#fffdf5'); lg.addColorStop(0.6, '#f5f0e8'); lg.addColorStop(1, '#ddd5c8');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = lg; ctx.fill();
    return;
  }

  // Terminator width: convert fraction to ellipse width
  // fraction=0 → tw=r (thin crescent), fraction=0.5 → tw=0 (quarter), fraction=1 → tw=r (full)
  const tw = r * Math.abs(2 * frac - 1);
  const isWaxing = phase < 0.5;
  const isGibbous = frac > 0.5;

  ctx.beginPath();
  if (isWaxing) {
    // Waxing: lit side on the RIGHT (as seen from northern hemisphere)
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false); // right semicircle (always lit)
    ctx.ellipse(cx, cy, tw, r, 0, Math.PI / 2, -Math.PI / 2, isGibbous); // terminator curves left
  } else {
    // Waning: lit side on the LEFT
    ctx.arc(cx, cy, r, Math.PI / 2, -Math.PI / 2, false); // left semicircle (always lit)
    ctx.ellipse(cx, cy, tw, r, 0, -Math.PI / 2, Math.PI / 2, isGibbous); // terminator curves right
  }
  ctx.closePath();
  const lg = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
  lg.addColorStop(0, '#fffdf5'); lg.addColorStop(0.6, '#f5f0e8'); lg.addColorStop(1, '#ddd5c8');
  ctx.fillStyle = lg; ctx.fill();
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

  // Moon indicator
  if (state.moonData) {
    const ma = moonAz * Math.PI / 180 - Math.PI / 2;
    const mr = R - 50;
    const gg = ctx.createRadialGradient(Math.cos(ma) * mr, Math.sin(ma) * mr, 0, Math.cos(ma) * mr, Math.sin(ma) * mr, 25);
    gg.addColorStop(0, 'rgba(201,168,124,0.25)'); gg.addColorStop(1, 'rgba(201,168,124,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(Math.cos(ma) * mr, Math.sin(ma) * mr, 25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(Math.cos(ma) * mr, Math.sin(ma) * mr, 10, 0, Math.PI * 2);
    ctx.fillStyle = state.moonData.isAboveHorizon ? '#c9a87c' : 'rgba(201,168,124,0.3)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ma) * (mr - 14), Math.sin(ma) * (mr - 14));
    ctx.strokeStyle = 'rgba(201,168,124,0.15)'; ctx.lineWidth = 1; ctx.stroke();
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
const sky = { stars: [], clouds: [], animId: null, w: 0, h: 0, time: 0 };

function initSkyBackground() {
  const canvas = $('stars');
  if (!canvas) return;
  sky.w = canvas.width = window.innerWidth;
  sky.h = canvas.height = window.innerHeight;

  // Generate stars (seeded for consistency)
  sky.stars = [];
  let seed = 42;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 180; i++) {
    sky.stars.push({
      x: r(), y: r(),
      size: r() * 1.4 + 0.3,
      baseAlpha: r() * 0.5 + 0.15,
      twinkleSpeed: r() * 0.004 + 0.001,
      twinklePhase: r() * Math.PI * 2
    });
  }

  // Generate clouds
  sky.clouds = [];
  for (let i = 0; i < 8; i++) {
    sky.clouds.push({
      x: r() * 1.4 - 0.2,  // start offscreen left
      y: r() * 0.6 + 0.05,
      w: r() * 300 + 150,
      h: r() * 80 + 40,
      speed: (r() * 0.00003 + 0.00001) * (r() > 0.5 ? 1 : 0.7),
      alpha: r() * 0.12 + 0.03
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

  const hour = new Date().getHours();
  const min = new Date().getMinutes();
  const timeF = hour + min / 60; // fractional hour
  const cloud = state.cloudCover ?? 20;

  ctx.clearRect(0, 0, w, h);

  // --- Sky gradient ---
  const grad = ctx.createLinearGradient(0, 0, 0, h);

  if (timeF >= 21 || timeF < 5) {
    // Deep night
    grad.addColorStop(0, '#050810');
    grad.addColorStop(0.4, '#0a0f1c');
    grad.addColorStop(1, '#06090f');
  } else if (timeF >= 5 && timeF < 7) {
    // Dawn
    const t = (timeF - 5) / 2;
    grad.addColorStop(0, lerpColor('#050810', '#1a2545', t));
    grad.addColorStop(0.5, lerpColor('#0a0f1c', '#2a1a3a', t));
    grad.addColorStop(0.8, lerpColor('#06090f', '#4a2030', t));
    grad.addColorStop(1, lerpColor('#06090f', '#6a3525', t));
  } else if (timeF >= 7 && timeF < 9) {
    // Morning
    const t = (timeF - 7) / 2;
    grad.addColorStop(0, lerpColor('#1a2545', '#1e3558', t));
    grad.addColorStop(0.5, lerpColor('#2a1a3a', '#254565', t));
    grad.addColorStop(1, lerpColor('#6a3525', '#1e3050', t));
  } else if (timeF >= 9 && timeF < 17) {
    // Day
    if (cloud > 70) {
      grad.addColorStop(0, '#2a3545');
      grad.addColorStop(0.5, '#354555');
      grad.addColorStop(1, '#2a3040');
    } else {
      grad.addColorStop(0, '#162840');
      grad.addColorStop(0.4, '#1e3858');
      grad.addColorStop(1, '#152535');
    }
  } else if (timeF >= 17 && timeF < 19) {
    // Sunset
    const t = (timeF - 17) / 2;
    grad.addColorStop(0, lerpColor('#162840', '#1a1830', t));
    grad.addColorStop(0.5, lerpColor('#1e3858', '#301830', t));
    grad.addColorStop(0.8, lerpColor('#152535', '#5a2520', t));
    grad.addColorStop(1, lerpColor('#152535', '#7a3015', t));
  } else {
    // Dusk (19-21)
    const t = (timeF - 19) / 2;
    grad.addColorStop(0, lerpColor('#1a1830', '#050810', t));
    grad.addColorStop(0.5, lerpColor('#301830', '#0a0f1c', t));
    grad.addColorStop(1, lerpColor('#5a2520', '#06090f', t));
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // --- Stars (night/twilight, less if cloudy) ---
  const isStarry = timeF >= 19 || timeF < 7;
  if (isStarry) {
    const starVisibility = Math.max(0, 1 - cloud / 100);
    const nightDepth = (timeF >= 21 || timeF < 5) ? 1 : (timeF >= 19 ? (timeF - 19) / 2 : (7 - timeF) / 2);
    const alpha = starVisibility * Math.min(1, nightDepth);

    sky.stars.forEach(s => {
      const twinkle = Math.sin(sky.time * s.twinkleSpeed + s.twinklePhase) * 0.25;
      const a = (s.baseAlpha + twinkle) * alpha;
      if (a < 0.02) return;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,248,${Math.max(0, a)})`;
      ctx.fill();
    });
  }

  // --- Animated clouds ---
  if (cloud > 15) {
    const numVisible = Math.ceil((cloud / 100) * sky.clouds.length);
    sky.clouds.slice(0, numVisible).forEach(c => {
      c.x += c.speed;
      if (c.x > 1.3) c.x = -0.3; // wrap around

      const cx = c.x * w;
      const cy = c.y * h;
      const cloudAlpha = c.alpha * (cloud / 100) * (isStarry ? 0.6 : 1);

      // Draw soft cloud blob
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, c.w * 0.5);
      cg.addColorStop(0, `rgba(160,170,190,${cloudAlpha})`);
      cg.addColorStop(0.5, `rgba(140,150,170,${cloudAlpha * 0.5})`);
      cg.addColorStop(1, 'rgba(140,150,170,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, c.w * 0.5, c.h * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Secondary blob for more natural shape
      const cg2 = ctx.createRadialGradient(cx + c.w * 0.25, cy - c.h * 0.15, 0, cx + c.w * 0.25, cy - c.h * 0.15, c.w * 0.35);
      cg2.addColorStop(0, `rgba(160,170,190,${cloudAlpha * 0.7})`);
      cg2.addColorStop(1, 'rgba(160,170,190,0)');
      ctx.fillStyle = cg2;
      ctx.beginPath();
      ctx.ellipse(cx + c.w * 0.25, cy - c.h * 0.15, c.w * 0.35, c.h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // --- Subtle sun glow (daytime, low on horizon at dawn/dusk) ---
  if (timeF >= 6 && timeF < 20 && cloud < 80) {
    let sunY, sunAlpha;
    if (timeF < 8) { sunY = h * (1 - (timeF - 6) / 4); sunAlpha = 0.08; }
    else if (timeF > 17) { sunY = h * (1 - (20 - timeF) / 6); sunAlpha = 0.1; }
    else { sunY = h * 0.15; sunAlpha = 0.04; }

    const sg = ctx.createRadialGradient(w * 0.5, sunY, 0, w * 0.5, sunY, 250);
    sg.addColorStop(0, `rgba(255,220,150,${sunAlpha})`);
    sg.addColorStop(0.3, `rgba(255,180,100,${sunAlpha * 0.4})`);
    sg.addColorStop(1, 'rgba(255,180,100,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
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
