// Repères physiques pré-calculés autour du 33 rue Boissy d'Anglas, Paris 8e
// Bearing calculé depuis 48.8688, 2.3208
// TOUS les repères sont à moins de 200m — rues adjacentes et commerces visibles

export const OBSERVER = {
  lat: 48.8688,
  lng: 2.3208,
  name: '33 rue Boissy d\'Anglas'
};

// Repères proches par direction (< 200m du 33 Boissy d'Anglas)
export const LANDMARKS = [
  // NORD (~0°) — rue Boissy d'Anglas remonte vers Fg St-Honoré
  { bearing: 0,   name: 'le haut de la rue Boissy d\'Anglas' },
  { bearing: 10,  name: 'la rue du Faubourg Saint-Honoré' },

  // NORD-EST (~30-60°) — vers rue d'Anjou / rue de Surène
  { bearing: 35,  name: 'la rue d\'Anjou' },
  { bearing: 55,  name: 'la rue de Surène' },

  // EST (~90°) — vers la Madeleine
  { bearing: 75,  name: 'la rue Royale' },
  { bearing: 95,  name: 'l\'église de la Madeleine' },

  // SUD-EST (~120-150°) — vers rue Saint-Honoré / Concorde
  { bearing: 120, name: 'la rue Saint-Honoré' },
  { bearing: 145, name: 'le début de la rue de Rivoli' },

  // SUD (~180°) — Place de la Concorde directement
  { bearing: 170, name: 'la place de la Concorde' },
  { bearing: 190, name: 'l\'Obélisque de la Concorde' },

  // SUD-OUEST (~210-240°) — vers le jardin / le pont
  { bearing: 215, name: 'le jardin des Tuileries' },
  { bearing: 240, name: 'le bas des Champs-Élysées' },

  // OUEST (~270°) — vers rue du Fg St-Honoré côté ouest
  { bearing: 265, name: 'la rue du Chevalier de Saint-George' },
  { bearing: 280, name: 'l\'avenue Gabriel' },

  // NORD-OUEST (~300-340°) — vers avenue Matignon
  { bearing: 310, name: 'la Cité Rétiro' },
  { bearing: 340, name: 'l\'avenue Matignon' }
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
  // Also find second-nearest for "entre X et Y" phrasing
  let second = LANDMARKS[0];
  let secondDiff = 360;
  for (const lm of LANDMARKS) {
    if (lm === best) continue;
    let diff = Math.abs(azimuth - lm.bearing);
    if (diff > 180) diff = 360 - diff;
    if (diff < secondDiff) {
      secondDiff = diff;
      second = lm;
    }
  }
  return { ...best, angleDiff: bestDiff, second, secondDiff };
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
