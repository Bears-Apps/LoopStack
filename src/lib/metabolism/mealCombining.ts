import type { CarbEntry } from '@/data/sources/types';
import { DELAYED_METABOLIC_PATTERN_ID } from './carbAbsorption';

// Combining carb entries into meals.
//
// One physiological event often arrives as several entries: the plate, the
// second helping forty minutes later, dessert at ninety. Analysing each entry
// as its own meal splits one glucose response across several "meals" and makes
// every one of them look under-covered. The rule here: entries within two
// hours of the previous entry belong to the same sitting, and the sitting is
// analysed as ONE meal — combined grams, grams-weighted absorption, the
// earliest entry's clock time.
//
// Two hours is the boundary between "same meal, kept eating" and "new meal on
// top of the old one's tail". Entries further apart than that stay separate
// meals, and the overlap machinery (attribution weights, absorption
// exclusions) handles the shared curve honestly instead of merging plates
// that were genuinely distinct decisions.

export const COMBO_GAP_HOURS = 2;

/** Entries below this are corrections and rescue carbs, not part of a meal. */
const MIN_ENTRY_GRAMS = 1;

export type CombinedMeal = {
  /** Clock time of the FIRST entry — when the sitting began. */
  iso: string;
  timeMs: number;
  /** Total grams across every entry in the sitting. */
  grams: number;
  /** Distinct labels joined, first-seen order — "Pizza night + Fruit crumble". */
  label: string | null;
  /** The sitting's absorption-pattern identifier, for `modelKindForEntry`.
   *  Loop grades each ENTRY on its own curve; a sitting is one meal here, so
   *  the rule mirrors how marked labels already combine: if any entry carries
   *  `delayed-metabolic-v1`, the sitting does. Otherwise, if any entry has no
   *  identifier the sitting has none either, so its joined label still reaches
   *  the legacy 🥜12h / 🍲8h path. Only a sitting whose every entry pins the
   *  standard model (or an unknown identifier) keeps that identifier. */
  absorptionPattern: string | null;
  /** Grams-weighted absorption across the entries, hours. */
  absorptionHours: number;
  /** How many carb entries were combined. 1 = a plain meal. */
  entryCount: number;
  /** Minutes from the first entry to the last. 0 for a plain meal. */
  spanMinutes: number;
  /** The raw entries, for anything that needs the components. */
  entries: CarbEntry[];
};

const ms = (iso: string) => new Date(iso).getTime();

export function combineCarbEntries(carbs: CarbEntry[]): CombinedMeal[] {
  const sorted = carbs
    .filter((c) => Number.isFinite(ms(c.iso)) && c.grams >= MIN_ENTRY_GRAMS)
    .sort((a, b) => ms(a.iso) - ms(b.iso));

  const out: CombinedMeal[] = [];

  for (const entry of sorted) {
    const t = ms(entry.iso);
    const last = out[out.length - 1];
    const lastEntryMs = last ? ms(last.entries[last.entries.length - 1].iso) : -Infinity;

    // Chained off the LAST entry, not the sitting's start: a long dinner where
    // each entry lands 90 minutes after the previous one is still one sitting.
    if (last && t - lastEntryMs <= COMBO_GAP_HOURS * 3600_000) {
      last.entries.push(entry);
      last.grams = +(last.grams + entry.grams).toFixed(1);
      last.spanMinutes = Math.round((t - last.timeMs) / 60_000);
      last.entryCount = last.entries.length;
      last.absorptionHours = weightedAbsorption(last.entries);
      if (entry.label) {
        const labels = last.label ? last.label.split(' + ') : [];
        if (!labels.includes(entry.label)) {
          last.label = [...labels, entry.label].slice(0, 3).join(' + ');
        }
      }
      last.absorptionPattern = combinePatterns(last.entries);
      continue;
    }

    out.push({
      iso: entry.iso,
      timeMs: t,
      grams: +entry.grams.toFixed(1),
      label: entry.label ?? null,
      absorptionPattern: entry.absorptionPattern ?? null,
      absorptionHours: entry.absorptionHours ?? 3,
      entryCount: 1,
      spanMinutes: 0,
      entries: [entry],
    });
  }

  return out;
}

/** See `CombinedMeal.absorptionPattern`. */
function combinePatterns(entries: CarbEntry[]): string | null {
  const patterns = entries.map((e) => e.absorptionPattern ?? null);
  if (patterns.includes(DELAYED_METABOLIC_PATTERN_ID)) return DELAYED_METABOLIC_PATTERN_ID;
  if (patterns.includes(null)) return null;
  return patterns[0];
}

/** Grams-weighted mean absorption across a sitting's entries. A 90 g plate at
 *  6 h with a 20 g dessert at 3 h is still mostly a 6 h event. */
function weightedAbsorption(entries: CarbEntry[]): number {
  let grams = 0;
  let weighted = 0;
  for (const e of entries) {
    const g = e.grams;
    grams += g;
    weighted += g * (e.absorptionHours ?? 3);
  }
  return grams > 0 ? +(weighted / grams).toFixed(2) : 3;
}
