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

/**
 * Whether a movement changes total stock. With a POS, "Out" only moves bottles from storage
 * to the bar (sales take out what's poured). Without one, a bottle sent out counts as used.
 */
export function affectsStock(kind: MovementKind, usesPos: boolean): boolean {
  return kind !== 'out' || !usesPos;
}

export interface StockTakeInput {
  productId: number;
  costCents: number;
  /** Count from the previous inventory, or null if this is the first one. */
  opening: number | null;
  /** Bottles received, wasted and sold (from POS recipes) since the previous inventory. All positive. */
  received: number;
  waste: number;
  sold: number;
  /** Bottles scanned Out to the bar. Counts as used when the bar has no POS. */
  sentOut: number;
  /** What the app thinks is on hand right now. */
  expected: number;
  /** What staff counted, or null if the product wasn't counted. */
  counted: number | null;
}

export interface StockTakeRow extends StockTakeInput {
  /** counted − expected. Negative means liquor is missing. Null if not counted. */
  variance: number | null;
  varianceCents: number | null;
  /** opening + received − counted: what actually left the shelf. Null without an opening count. */
  actualUsage: number | null;
  /** What the records account for: sold + waste with a POS, sent out + waste without. */
  recordedUsage: number;
}

export interface StockTakeReport {
  rows: StockTakeRow[];
  counted: number;
  uncounted: number;
  /** Sum of negative variances, in cents (a positive number). */
  shortfallCents: number;
  /** Net variance across counted products, in cents. */
  netVarianceCents: number;
  /** recorded ÷ actual usage across products with an opening count, or null if none. 1 = records match the shelf. */
  salesAccuracy: number | null;
  usesPos: boolean;
}

export function stockTakeReport(inputs: StockTakeInput[], usesPos = true): StockTakeReport {
  let shortfallCents = 0;
  let netVarianceCents = 0;
  let actualTotal = 0;
  let recordedTotal = 0;
  const rows = inputs.map<StockTakeRow>(i => {
    const recordedUsage = round2((usesPos ? i.sold : i.sentOut) + i.waste);
    if (i.counted === null) {
      return { ...i, variance: null, varianceCents: null, actualUsage: null, recordedUsage };
    }
    const variance = round2(i.counted - i.expected);
    const varianceCents = Math.round(variance * i.costCents);
    netVarianceCents += varianceCents;
    if (varianceCents < 0) shortfallCents -= varianceCents;
    const actualUsage = i.opening === null ? null : round2(i.opening + i.received - i.counted);
    if (actualUsage !== null) {
      actualTotal += actualUsage * i.costCents;
      recordedTotal += recordedUsage * i.costCents;
    }
    return { ...i, variance, varianceCents, actualUsage, recordedUsage };
  });
  const counted = rows.filter(r => r.counted !== null).length;
  return {
    rows,
    counted,
    uncounted: rows.length - counted,
    shortfallCents,
    netVarianceCents,
    salesAccuracy: actualTotal > 0 ? recordedTotal / actualTotal : null,
    usesPos,
  };
}
