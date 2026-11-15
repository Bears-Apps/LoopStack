// Loop and Learn's prepared customizations. The list lives in
// electron/customizations.json so the main process, which commits patches,
// enforces the same dosing confirmations the page shows (PRODUCT.md SAFE-3).
import catalog from '../../electron/customizations.json';
import personal from '../../electron/personal-features.json';

export interface Customization {
  id: string;
  name: string;
  what: string;
  dosing: boolean;
  /** Offered in the library. no_auth is listed but never offered: it removes a safety feature. */
  offered: boolean;
}

export const CUSTOMIZATIONS: readonly Customization[] = catalog.items;
export const CATALOG_SOURCE: string = catalog.source;

const BY_ID = new Map(CUSTOMIZATIONS.map((c) => [c.id, c]));
/** A customization by id; an unknown id (a personal patch file) is treated as dosing, to be safe. */
export const customization = (id: string): Customization =>
  BY_ID.get(id) ?? { id, name: id, what: 'Not in Loop and Learn’s list. LoopStack can’t tell what it changes.', dosing: true, offered: false };

// The person's own patches, by file name without its number. Shared with
// electron/personal.cjs, which enforces the same dosing and safety rules.

export interface PersonalFeature {
  id: string;
  name: string;
  what: string;
  bundle?: string[];
  /** Anything the person should know about what on and off mean for this one. */
  note?: string;
  icon: string;
  dosing: boolean;
  /** false: LoopStack turns it off but never on (it removes a safety check). */
  canTurnOn: boolean;
  source: string;
  rank: number;
  known: boolean;
}

const PERSONAL = new Map(personal.items.map((c) => [c.id, c]));
export const WORKFLOW_ICONS: Record<string, string> = personal.workflowIcons;
/** The features LoopStack knows by name, in card order: the library's preview before a Loop is connected. */
export const KNOWN_PERSONAL: readonly PersonalFeature[] = personal.items.map((c) => ({ ...c, known: true })).sort((a, b) => a.rank - b.rank);
export const stemOf = (file: string) => file.replace(/\.patch$/, '').replace(/^\d+[-_ ]*/, '');

/** What LoopStack knows about a patch file; an unknown one is named from its file and treated as dosing. */
export function personalFeature(file: string): PersonalFeature {
  const c = PERSONAL.get(stemOf(file));
  if (c) return { ...c, known: true };
  const words = stemOf(file).replace(/[-_]+/g, ' ').trim();
  return { id: stemOf(file), name: words ? words[0].toUpperCase() + words.slice(1) : file, what: 'A patch in your patches folder that LoopStack doesn’t know. It can’t tell what it changes, so it treats it as changing dosing.', icon: 'patch', dosing: true, canTurnOn: true, source: 'Your patches folder', rank: 100, known: false };
}
