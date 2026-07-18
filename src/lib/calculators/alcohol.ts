/**
 * Alcohol conversion utilities.
 *
 * Converts a number of "shots" of an alcoholic beverage into grams of pure
 * ethanol — the standard unit used worldwide for tracking alcohol consumption
 * (e.g. UK units, US standard drinks, Australian standard drinks).
 *
 * The conversion is a two-step physical calculation:
 *
 *   1. Volume of the beverage (mL) × ABV (fraction) = volume of pure ethanol (mL)
 *   2. Volume of ethanol (mL) × density of ethanol (0.789 g/mL) = grams of ethanol
 *
 * So:  grams = shots × shotVolumeMl × (abv / 100) × ETHANOL_DENSITY
 *
 * A "shot" is a volume measure that varies by jurisdiction, so we expose a set
 * of regional presets. ABV varies by beverage type, so we expose beverage
 * presets as well.
 */

/** Density of pure ethanol at 20°C, in grams per millilitre. */
export const ETHANOL_DENSITY_G_PER_ML = 0.789;

/** 1 US fluid ounce in millilitres. */
export const ML_PER_US_FL_OZ = 29.5735;
/** 1 imperial (UK) fluid ounce in millilitres. */
export const ML_PER_IMP_FL_OZ = 28.4131;

// ─── Shot size presets ──────────────────────────────────────────────────────

export interface ShotSize {
  id: string;
  label: string;
  /** Volume of a single shot in millilitres. */
  volumeMl: number;
  notes: string;
}

export const SHOT_SIZES: ShotSize[] = [
  {
    id: 'us-single',
    label: 'US shot (1.5 fl oz)',
    volumeMl: ML_PER_US_FL_OZ * 1.5, // 44.36 mL
    notes: 'Standard US pour, ~44.4 mL. Used in most American bars.',
  },
  {
    id: 'us-double',
    label: 'US double (2.5 fl oz)',
    volumeMl: ML_PER_US_FL_OZ * 2.5, // 73.93 mL
    notes: 'Common US double pour, ~73.9 mL.',
  },
  {
    id: 'uk-single',
    label: 'UK single (25 mL)',
    volumeMl: 25,
    notes: 'Legal UK single measure. 25 mL at 40% ABV = 1 UK unit (8 g ethanol).',
  },
  {
    id: 'uk-double',
    label: 'UK double (50 mL)',
    volumeMl: 50,
    notes: 'Legal UK double measure. 50 mL at 40% ABV = 2 UK units (16 g ethanol).',
  },
  {
    id: 'eu-standard',
    label: 'EU standard (40 mL)',
    volumeMl: 40,
    notes: 'Common European pour, ~40 mL.',
  },
  {
    id: 'australian',
    label: 'Australian nip (30 mL)',
    volumeMl: 30,
    notes: 'Standard Australian pour. 30 mL at 40% ABV = 1 Australian standard drink (10 g ethanol).',
  },
  {
    id: 'japanese',
    label: 'Japanese go (180 mL / sake)',
    volumeMl: 180,
    notes: 'Traditional Japanese sake measure (1 go). Not a "shot" but useful for sake.',
  },
  {
    id: 'custom',
    label: 'Custom volume…',
    volumeMl: 44.36,
    notes: 'Enter your own shot volume in mL.',
  },
];

// ─── Beverage presets ───────────────────────────────────────────────────────

export interface BeveragePreset {
  id: string;
  label: string;
  abv: number;
  notes: string;
}

export const BEVERAGE_PRESETS: BeveragePreset[] = [
  {
    id: 'spirits',
    label: 'Spirits (vodka, gin, whiskey, rum, tequila)',
    abv: 40,
    notes: 'Standard 40% ABV (80 proof). Most common for mixed drinks.',
  },
  {
    id: 'spirits-high',
    label: 'High-proof spirits (cask strength, overproof rum)',
    abv: 50,
    notes: '50% ABV (100 proof). Navy strength gin, overproof rum.',
  },
  {
    id: 'spirits-low',
    label: 'Low-proof spirits (liqueurs, flavored vodkas)',
    abv: 20,
    notes: '~20% ABV. Many liqueurs, flavored vodkas, some aperitifs.',
  },
  {
    id: 'wine',
    label: 'Wine (table wine)',
    abv: 12.5,
    notes: 'Typical 12–13.5% ABV. A standard "glass" is ~150 mL.',
  },
  {
    id: 'wine-fortified',
    label: 'Fortified wine (port, sherry, vermouth)',
    abv: 18,
    notes: '~17–20% ABV. Port, sherry, vermouth, madeira.',
  },
  {
    id: 'beer',
    label: 'Beer (standard lager/ale)',
    abv: 5,
    notes: 'Typical 4.5–5.5% ABV. A standard can/bottle is ~355 mL.',
  },
  {
    id: 'beer-strong',
    label: 'Strong beer (IPA, stout, craft)',
    abv: 8,
    notes: '~7–10% ABV. Many craft IPAs, imperial stouts, barleywines.',
  },
  {
    id: 'cider',
    label: 'Cider',
    abv: 5,
    notes: 'Typical 4.5–6% ABV. Similar to standard beer.',
  },
  {
    id: 'sake',
    label: 'Sake',
    abv: 15,
    notes: '~15% ABV. Traditional Japanese rice wine.',
  },
  {
    id: 'custom',
    label: 'Custom ABV…',
    abv: 40,
    notes: 'Enter your own ABV percentage.',
  },
];

// ─── Standard drink definitions ─────────────────────────────────────────────

export interface StandardDrink {
  id: string;
  label: string;
  /** Grams of pure ethanol per standard drink. */
  gramsEthanol: number;
}

export const STANDARD_DRINKS: StandardDrink[] = [
  {
    id: 'us',
    label: 'US standard drink',
    gramsEthanol: 14,
  },
  {
    id: 'uk',
    label: 'UK unit',
    gramsEthanol: 8,
  },
  {
    id: 'australian',
    label: 'Australian standard drink',
    gramsEthanol: 10,
  },
  {
    id: 'who',
    label: 'WHO standard drink',
    gramsEthanol: 10,
  },
  {
    id: 'canadian',
    label: 'Canadian standard drink',
    gramsEthanol: 13.45,
  },
];

// ─── Core conversion functions ──────────────────────────────────────────────

/** Round a number to a given decimal precision. */
export function roundTo(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Find a shot size preset by ID. */
export function getShotSize(id: string): ShotSize | undefined {
  return SHOT_SIZES.find((s) => s.id === id);
}

/** Find a beverage preset by ID. */
export function getBeveragePreset(id: string): BeveragePreset | undefined {
  return BEVERAGE_PRESETS.find((b) => b.id === id);
}

/**
 * Convert shots → grams of pure ethanol.
 *
 * @param shots Number of shots
 * @param shotVolumeMl Volume of one shot in mL
 * @param abv Alcohol by volume (%)
 * @returns Object with ethanol grams, volumes, and standard drink equivalents
 */
export function shotsToGrams({
  shots,
  shotVolumeMl,
  abv,
}: {
  shots: number;
  shotVolumeMl: number;
  abv: number;
}) {
  if (shots <= 0 || shotVolumeMl <= 0 || abv <= 0) {
    return null;
  }

  const totalVolumeMl = shots * shotVolumeMl;
  const ethanolVolumeMl = totalVolumeMl * (abv / 100);
  const ethanolGrams = ethanolVolumeMl * ETHANOL_DENSITY_G_PER_ML;
  const ethanolOunces = ethanolGrams / 28.3495;
  const gramsPerShot = ethanolGrams / shots;

  // Standard drink equivalents
  const standardDrinks: Record<string, number> = {};
  for (const sd of STANDARD_DRINKS) {
    standardDrinks[sd.id] = roundTo(ethanolGrams / sd.gramsEthanol, 2);
  }

  return {
    shots,
    shotVolumeMl,
    abv,
    totalVolumeMl: roundTo(totalVolumeMl, 1),
    ethanolVolumeMl: roundTo(ethanolVolumeMl, 1),
    ethanolGrams: roundTo(ethanolGrams, 2),
    ethanolOunces: roundTo(ethanolOunces, 3),
    gramsPerShot: roundTo(gramsPerShot, 2),
    standardDrinks,
  };
}

/**
 * Convert target grams of ethanol → number of shots.
 *
 * @param targetGrams Desired grams of pure ethanol
 * @param shotVolumeMl Volume of one shot in mL
 * @param abv Alcohol by volume (%)
 * @returns Number of shots needed (can be fractional), or null if inputs invalid
 */
export function gramsToShots(
  targetGrams: number,
  shotVolumeMl: number,
  abv: number,
): number | null {
  if (targetGrams <= 0 || shotVolumeMl <= 0 || abv <= 0) {
    return null;
  }
  const gramsPerShot = shotVolumeMl * (abv / 100) * ETHANOL_DENSITY_G_PER_ML;
  return roundTo(targetGrams / gramsPerShot, 2);
}

/**
 * Convert grams of ethanol → equivalent drinks for common beverage types.
 * Uses default shot sizes for each beverage type.
 */
export function gramsToDrinks(targetGrams: number): {
  shots: { us: number; uk: number; eu: number };
  standardDrinks: { us: number; uk: number; australian: number };
} | null {
  if (targetGrams <= 0) return null;

  // Spirits: 40% ABV
  const spiritShotUs = getShotSize('us-single')?.volumeMl ?? 44.36;
  const spiritShotUk = getShotSize('uk-single')?.volumeMl ?? 25;
  const spiritShotEu = getShotSize('eu-standard')?.volumeMl ?? 40;

  // Wine: 12.5% ABV, 150ml glass
  const wineGlassMl = 150;
  const wineAbv = 12.5;

  // Beer: 5% ABV, 355ml can
  const beerCanMl = 355;
  const beerAbv = 5;

  const shots = {
    us: roundTo(gramsToShots(targetGrams, spiritShotUs, 40) ?? 0, 2),
    uk: roundTo(gramsToShots(targetGrams, spiritShotUk, 40) ?? 0, 2),
    eu: roundTo(gramsToShots(targetGrams, spiritShotEu, 40) ?? 0, 2),
  };

  const wineGrams = wineGlassMl * (wineAbv / 100) * ETHANOL_DENSITY_G_PER_ML;
  const beerGrams = beerCanMl * (beerAbv / 100) * ETHANOL_DENSITY_G_PER_ML;

  const standardDrinks = {
    us: roundTo(targetGrams / 14, 2),
    uk: roundTo(targetGrams / 8, 2),
    australian: roundTo(targetGrams / 10, 2),
  };

  return { shots, standardDrinks };
}