// Repères physiques pré-calculés autour du 33 rue Boissy d'Anglas, Paris 8e
// Bearing calculé depuis 48.8688, 2.3208

export const OBSERVER = {
  lat: 48.8688,
  lng: 2.3208,
  name: '33 rue Boissy d\'Anglas'
};

// Directions cardinales → repères physiques du quartier
// Chaque repère a un bearing (azimut) et un nom lisible
export const LANDMARKS = [
  { bearing: 0,   name: 'la rue du Faubourg Saint-Honoré' },
  { bearing: 30,  name: 'le boulevard Haussmann' },
  { bearing: 60,  name: 'l\'Opéra Garnier' },
  { bearing: 90,  name: 'la rue Royale' },
  { bearing: 110, name: 'l\'église de la Madeleine' },
  { bearing: 135, name: 'la place Vendôme' },
  { bearing: 160, name: 'le jardin des Tuileries' },
  { bearing: 180, name: 'la place de la Concorde' },
  { bearing: 210, name: 'le pont de la Concorde' },
  { bearing: 240, name: 'le Grand Palais' },
  { bearing: 270, name: 'les Champs-Élysées' },
  { bearing: 300, name: 'l\'avenue Matignon' },
  { bearing: 330, name: 'le Palais de l\'Élysée' }
];

// Trouve le repère le plus proche d'un azimut donné
export function findNearestLandmark(azimuth) {
  let best = LANDMARKS[0];
  let bestDiff = 360;
  for (const lm of LANDMARKS) {
    let diff = Math.abs(azimuth - lm.bearing);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = lm;
    }
  }
  return { ...best, angleDiff: bestDiff };
}

// Description d'altitude lisible
export function altitudeText(altitude) {
  if (altitude > 60) return 'presque au-dessus de toi';
  if (altitude > 40) return 'haute dans le ciel';
  if (altitude > 20) return 'à mi-hauteur';
  if (altitude > 5)  return 'assez basse sur l\'horizon';
  return 'au ras des toits';
}

// Nom de la phase lunaire en français
export function phaseName(phaseAngle) {
  if (phaseAngle < 1 || phaseAngle > 359)  return 'Nouvelle Lune';
  if (phaseAngle < 89)  return 'Premier croissant';
  if (phaseAngle < 91)  return 'Premier quartier';
  if (phaseAngle < 179) return 'Gibbeuse croissante';
  if (phaseAngle < 181) return 'Pleine Lune';
  if (phaseAngle < 269) return 'Gibbeuse décroissante';
  if (phaseAngle < 271) return 'Dernier quartier';
  return 'Dernier croissant';
}
