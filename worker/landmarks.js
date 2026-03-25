// Directions visibles DEPUIS LA SORTIE du 33 rue Boissy d'Anglas, Paris 8e
// Ce sont les directions dans lesquelles Agnes peut REGARDER en sortant,
// pas des lieux qu'elle peut atteindre à pied.
// Bearing calculé depuis 48.8688, 2.3208

export const OBSERVER = {
  lat: 48.8688,
  lng: 2.3208,
  name: '33 rue Boissy d\'Anglas'
};

// La rue Boissy d'Anglas va du nord (Fg St-Honoré) au sud (Concorde).
// En sortant du 33, Agnes voit :
// - Au nord : la rue qui remonte vers le Fg St-Honoré
// - Au sud : la rue qui descend vers la Concorde
// - Les rues adjacentes et les bâtiments visibles depuis ce point

export const LANDMARKS = [
  // En remontant la rue (nord)
  { bearing: 5,   name: 'en remontant vers le Faubourg Saint-Honoré' },

  // Rues qui partent à droite (est/nord-est) depuis Boissy d'Anglas
  { bearing: 40,  name: 'vers la rue de Surène' },
  { bearing: 80,  name: 'vers la rue Royale, côté Madeleine' },

  // En descendant la rue (sud) vers la Concorde
  { bearing: 140, name: 'en descendant la rue, vers la Concorde' },
  { bearing: 175, name: 'tout droit vers la place de la Concorde' },
  { bearing: 200, name: 'vers la Concorde, côté Tuileries' },

  // Côté gauche en sortant (ouest)
  { bearing: 250, name: 'vers la Cité Rétiro' },
  { bearing: 280, name: 'vers l\'avenue Gabriel' },
  { bearing: 320, name: 'vers l\'avenue Matignon' },
  { bearing: 350, name: 'vers le Faubourg Saint-Honoré, côté Élysée' }
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
