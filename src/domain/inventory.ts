// Pure inventory math. No React, no database, so it can be unit tested with `npm test`.
// Stock is stored in bottles (fractional), because that is how bars count shelves.

export const ML_PER_OZ = 29.5735;

export type MovementKind = 'in' | 'out' | 'waste' | 'sale' | 'count';

export interface Product {
  id: number;
  upc: string;
  name: string;
  category: string;
  sizeMl: number;
  costCents: number;
  par: number;
  onHand: number;
}

export interface RecipePour {
  productId: number;
  oz: number;
}

export interface SaleLine {
  posItemId: string;
  name: string;
  quantity: number;
}

export type StockStatus = 'ok' | 'low' | 'out';

export function stockStatus(p: Pick<Product, 'onHand' | 'par'>): StockStatus {
  if (p.onHand <= 0) return 'out';
  if (p.onHand < p.par) return 'low';
  return 'ok';
}

export function ozToBottles(oz: number, sizeMl: number): number {
  return (oz * ML_PER_OZ) / sizeMl;
}

/** Signed change in bottles for a scan. `in` adds, `out` and `waste` subtract. */
export function movementDelta(kind: Exclude<MovementKind, 'sale' | 'count'>, bottles: number): number {
  if (bottles <= 0 || !Number.isFinite(bottles)) throw new Error('Quantity must be a positive number');
  return kind === 'in' ? bottles : -bottles;
}

/** Applies a delta without letting stock go negative. Returns the delta actually applied. */
export function clampDelta(onHand: number, delta: number): number {
  return Math.max(-onHand, delta);
}

/**
 * Turns POS sale lines into per-product bottle depletions using recipes.
 * Lines without a recipe are returned in `unmapped` so staff can link them.
 */
export function depletionsForSale(
  lines: SaleLine[],
  recipes: Map<string, RecipePour[]>,
  products: Map<number, Pick<Product, 'sizeMl'>>,
): { depletions: Map<number, number>; unmapped: SaleLine[] } {
  const depletions = new Map<number, number>();
  const unmapped: SaleLine[] = [];
  for (const line of lines) {
    // Recipes made from an unmatched sale are keyed by name, so fall back to that.
    const pours = recipes.get(line.posItemId) ?? recipes.get(`name:${line.name}`);
    if (!pours || pours.length === 0) {
      unmapped.push(line);
      continue;
    }
    for (const pour of pours) {
      const product = products.get(pour.productId);
      if (!product) continue;
      const bottles = ozToBottles(pour.oz * line.quantity, product.sizeMl);
      depletions.set(pour.productId, (depletions.get(pour.productId) ?? 0) + bottles);
    }
  }
  return { depletions, unmapped };
}

export interface VarianceRow {
  productId: number;
  expected: number;
  counted: number;
  variance: number;
  costCents: number;
}

/** Counted minus expected. Negative means liquor is missing. */
export function variance(p: Pick<Product, 'id' | 'onHand' | 'costCents'>, counted: number): VarianceRow {
  const v = round2(counted - p.onHand);
  return { productId: p.id, expected: p.onHand, counted, variance: v, costCents: Math.round(v * p.costCents) };
}

export function bottlesToReorder(p: Pick<Product, 'onHand' | 'par'>): number {
  return Math.max(0, Math.ceil(p.par - p.onHand));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Normalizes scanner output: UPC-A is often reported as EAN-13 with a leading zero. */
export function normalizeBarcode(raw: string): string {
  const digits = raw.trim().replace(/\s+/g, '');
  if (/^0\d{12}$/.test(digits)) return digits.slice(1);
  return digits;
}
