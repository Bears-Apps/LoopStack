// Meal favorites into Loop: the bridge to electron/favorites.cjs.
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
export interface FavoriteFood { id?: string; name: string; foodType: string; grams: number; absorptionMin: number; addedAt?: string }
export interface FavoritesBridge {
  list: () => Promise<Result<{ foods: FavoriteFood[] }>>;
  preview: (input: { food: FavoriteFood }) => Promise<Result<{ food: FavoriteFood; patch: string; count: number }>>;
  add: (input: { food: FavoriteFood; reviewed: boolean; confirmDosing: boolean }) => Promise<Result<{ commit: { sha: string; url: string }; foods: FavoriteFood[] }>>;
}
export const favoritesBridge = (): FavoritesBridge | null => window.loopstack?.favorites ?? null;

/** Loop's absorption choices for a favorite, 30 minutes to 8 hours. */
export const ABSORPTION_CHOICES = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);

/** "🌯 Burrito bowl" → { foodType: "🌯", name: "Burrito bowl" }; Loop's food type is often just the emoji. */
export function splitFoodName(label: string): { foodType: string; name: string } {
  const m = label.trim().match(/^(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️)*)\s*(.*)$/u);
  if (m) return { foodType: m[1], name: m[2] };
  return label.length <= 3 ? { foodType: label, name: '' } : { foodType: '', name: label };
}
