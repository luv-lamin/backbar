import type { SQLiteDatabase } from 'expo-sqlite';
import {
  affectsStock,
  clampDelta,
  depletionsForSale,
  type MovementKind,
  type Product,
  type RecipePour,
  type SaleLine,
  stockTakeReport,
  type StockTakeReport,
  type WasteEntry,
  type WasteReason,
} from '../domain/inventory';

interface ProductRow {
  id: number;
  upc: string;
  name: string;
  category: string;
  size_ml: number;
  cost_cents: number;
  par: number;
  on_hand: number;
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  upc: r.upc,
  name: r.name,
  category: r.category,
  sizeMl: r.size_ml,
  costCents: r.cost_cents,
  par: r.par,
  onHand: r.on_hand,
});

export async function listProducts(db: SQLiteDatabase): Promise<Product[]> {
  const rows = await db.getAllAsync<ProductRow>('SELECT * FROM products ORDER BY category, name');
  return rows.map(toProduct);
}

export async function findByUpc(db: SQLiteDatabase, upc: string): Promise<Product | null> {
  const row = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE upc = ?', upc);
  return row ? toProduct(row) : null;
}

export type NewProduct = Omit<Product, 'id' | 'onHand'>;

export async function addProduct(db: SQLiteDatabase, p: NewProduct): Promise<Product> {
  const res = await db.runAsync(
    'INSERT INTO products (upc, name, category, size_ml, cost_cents, par) VALUES (?, ?, ?, ?, ?, ?)',
    p.upc, p.name, p.category, p.sizeMl, p.costCents, p.par,
  );
  return { ...p, id: res.lastInsertRowId, onHand: 0 };
}

/** Records a movement and updates stock in one transaction. Returns the new on-hand. */
export async function recordMovement(
  db: SQLiteDatabase,
  productId: number,
  kind: MovementKind,
  delta: number,
  source = 'scan',
  note: string | null = null,
  reason: WasteReason | null = null,
): Promise<number> {
  let onHand = 0;
  await db.withTransactionAsync(async () => {
    onHand = await applyDelta(db, productId, kind, delta, source, note, reason);
  });
  return onHand;
}

async function applyDelta(
  db: SQLiteDatabase,
  productId: number,
  kind: MovementKind,
  delta: number,
  source: string,
  note: string | null,
  reason: WasteReason | null = null,
): Promise<number> {
  const row = await db.getFirstAsync<{ on_hand: number }>('SELECT on_hand FROM products WHERE id = ?', productId);
  if (!row) throw new Error('Product not found');
  const applied = clampDelta(row.on_hand, delta);
  // POS sales aren't done by whoever holds this phone.
  const staffId = source === 'scan' || source === 'inventory' ? await getCurrentStaffId(db) : null;
  await db.runAsync(
    'INSERT INTO movements (product_id, kind, bottles, source, note, staff_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
    productId, kind, applied, source, note, staffId, reason,
  );
  // With a POS, Out is only logged (who moved what to the bar); sales take it out of stock when it's poured.
  if (!affectsStock(kind, await getUsesPos(db))) return row.on_hand;
  const onHand = row.on_hand + applied;
  await db.runAsync('UPDATE products SET on_hand = ? WHERE id = ?', onHand, productId);
  return onHand;
}

export interface ActivityRow {
  id: number;
  kind: MovementKind;
  bottles: number;
  source: string;
  note: string | null;
  createdAt: string;
  productName: string;
}

export async function recentActivity(db: SQLiteDatabase, limit = 30): Promise<ActivityRow[]> {
  return db.getAllAsync<ActivityRow>(
    `SELECT m.id, m.kind, m.bottles, m.source, m.note, m.created_at AS createdAt, p.name AS productName
     FROM movements m JOIN products p ON p.id = m.product_id
     ORDER BY m.id DESC LIMIT ?`,
    limit,
  );
}

export interface RecipeWithPours {
  id: number;
  provider: string;
  posItemId: string;
  name: string;
  pours: (RecipePour & { productName: string })[];
}

export async function listRecipes(db: SQLiteDatabase): Promise<RecipeWithPours[]> {
  const recipes = await db.getAllAsync<{ id: number; provider: string; pos_item_id: string; name: string }>(
    'SELECT * FROM recipes ORDER BY name',
  );
  const pours = await db.getAllAsync<{ recipe_id: number; product_id: number; oz: number; name: string }>(
    'SELECT rp.recipe_id, rp.product_id, rp.oz, p.name FROM recipe_pours rp JOIN products p ON p.id = rp.product_id',
  );
  return recipes.map(r => ({
    id: r.id,
    provider: r.provider,
    posItemId: r.pos_item_id,
    name: r.name,
    pours: pours
      .filter(p => p.recipe_id === r.id)
      .map(p => ({ productId: p.product_id, oz: p.oz, productName: p.name })),
  }));
}

export async function upsertRecipe(
  db: SQLiteDatabase,
  provider: string,
  posItemId: string,
  name: string,
  pours: RecipePour[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO recipes (provider, pos_item_id, name) VALUES (?, ?, ?)
       ON CONFLICT (provider, pos_item_id) DO UPDATE SET name = excluded.name`,
      provider, posItemId, name,
    );
    const r = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM recipes WHERE provider = ? AND pos_item_id = ?', provider, posItemId,
    );
    await db.runAsync('DELETE FROM recipe_pours WHERE recipe_id = ?', r!.id);
    for (const pour of pours) {
      await db.runAsync('INSERT INTO recipe_pours (recipe_id, product_id, oz) VALUES (?, ?, ?)', r!.id, pour.productId, pour.oz);
    }
  });
}

/** Provider value for recipes that apply whatever POS the bar uses. */
export const ANY_POS = 'any';

export interface Sale {
  id: string;
  lines: SaleLine[];
}

/**
 * Deducts POS sales from stock using recipes. Each sale is applied at most once,
 * so pulling the same window twice is safe. Returns item names with no recipe.
 */
export async function applySales(db: SQLiteDatabase, provider: string, sales: Sale[]): Promise<{ applied: number; unmapped: string[] }> {
  // This POS's own item ids first, then any recipe by drink name, so recipes carry over when a bar switches POS.
  const recipes = new Map<string, RecipePour[]>();
  const all = await listRecipes(db);
  for (const r of all) if (r.provider === provider) recipes.set(r.posItemId, r.pours);
  for (const r of all) if (!recipes.has(`name:${r.name}`)) recipes.set(`name:${r.name}`, r.pours);
  const products = new Map((await listProducts(db)).map(p => [p.id, p] as const));
  const unmapped = new Set<string>();
  let applied = 0;

  await db.withTransactionAsync(async () => {
    for (const sale of sales) {
      const res = await db.runAsync(
        'INSERT OR IGNORE INTO processed_sales (provider, sale_id) VALUES (?, ?)', provider, sale.id,
      );
      if (res.changes === 0) continue;
      const { depletions, unmapped: missing } = depletionsForSale(sale.lines, recipes, products);
      missing.forEach(l => unmapped.add(l.name));
      for (const [productId, bottles] of depletions) {
        await applyDelta(db, productId, 'sale', -bottles, provider, `Order ${sale.id}`);
      }
      applied++;
    }
  });
  return { applied, unmapped: [...unmapped] };
}

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
}

// ---- Inventory mode (full stock take) ----

export interface InventorySession {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  report: StockTakeReport | null;
}

interface SessionRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  last_movement_id: number | null;
  report: string | null;
}

const toSession = (r: SessionRow): InventorySession => ({
  id: r.id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  report: r.report ? (JSON.parse(r.report) as StockTakeReport) : null,
});

export async function openInventory(db: SQLiteDatabase): Promise<InventorySession | null> {
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM inventory_sessions WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1');
  return row ? toSession(row) : null;
}

export async function finishedInventories(db: SQLiteDatabase, limit = 12): Promise<InventorySession[]> {
  const rows = await db.getAllAsync<SessionRow>(
    'SELECT * FROM inventory_sessions WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT ?', limit,
  );
  return rows.map(toSession);
}

export async function startInventory(db: SQLiteDatabase): Promise<InventorySession> {
  const existing = await openInventory(db);
  if (existing) return existing;
  await db.runAsync('INSERT INTO inventory_sessions DEFAULT VALUES');
  return (await openInventory(db))!;
}

/** Adds to (or with a negative number, takes from) a product's count. Returns the new count. */
export async function addToCount(db: SQLiteDatabase, sessionId: number, productId: number, bottles: number): Promise<number> {
  await db.runAsync(
    `INSERT INTO inventory_counts (session_id, product_id, bottles) VALUES (?, ?, MAX(0, ?))
     ON CONFLICT (session_id, product_id) DO UPDATE SET bottles = MAX(0, bottles + ?)`,
    sessionId, productId, bottles, bottles,
  );
  const row = await db.getFirstAsync<{ bottles: number }>(
    'SELECT bottles FROM inventory_counts WHERE session_id = ? AND product_id = ?', sessionId, productId,
  );
  return row?.bottles ?? 0;
}

export async function setCount(db: SQLiteDatabase, sessionId: number, productId: number, bottles: number | null): Promise<void> {
  if (bottles === null) {
    await db.runAsync('DELETE FROM inventory_counts WHERE session_id = ? AND product_id = ?', sessionId, productId);
    return;
  }
  await db.runAsync(
    `INSERT INTO inventory_counts (session_id, product_id, bottles) VALUES (?, ?, ?)
     ON CONFLICT (session_id, product_id) DO UPDATE SET bottles = excluded.bottles`,
    sessionId, productId, Math.max(0, bottles),
  );
}

export async function inventoryCounts(db: SQLiteDatabase, sessionId: number): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ product_id: number; bottles: number }>(
    'SELECT product_id, bottles FROM inventory_counts WHERE session_id = ?', sessionId,
  );
  return new Map(rows.map(r => [r.product_id, r.bottles]));
}

export async function cancelInventory(db: SQLiteDatabase, sessionId: number): Promise<void> {
  await db.runAsync('DELETE FROM inventory_sessions WHERE id = ? AND finished_at IS NULL', sessionId);
}

/**
 * Builds the report, then sets stock to what was counted. Products that weren't
 * counted keep their current stock unless `uncountedAsZero` is set.
 */
export async function finishInventory(db: SQLiteDatabase, sessionId: number, uncountedAsZero: boolean): Promise<StockTakeReport> {
  let report!: StockTakeReport;
  await db.withTransactionAsync(async () => {
    const prev = await db.getFirstAsync<{ id: number; last_movement_id: number | null }>(
      'SELECT id, last_movement_id FROM inventory_sessions WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1',
    );
    const since = prev?.last_movement_id ?? 0;
    const last = (await db.getFirstAsync<{ id: number | null }>('SELECT MAX(id) AS id FROM movements'))?.id ?? 0;
    const opening = prev ? await inventoryCounts(db, prev.id) : new Map<number, number>();
    const sums = await db.getAllAsync<{ product_id: number; kind: MovementKind; total: number }>(
      `SELECT product_id, kind, SUM(bottles) AS total FROM movements
       WHERE id > ? AND id <= ? AND kind IN ('in', 'out', 'waste', 'sale') GROUP BY product_id, kind`,
      since, last,
    );
    const counts = await inventoryCounts(db, sessionId);
    const products = await listProducts(db);
    const sum = (id: number, kind: MovementKind) => Math.abs(sums.find(s => s.product_id === id && s.kind === kind)?.total ?? 0);

    report = stockTakeReport(products.map(p => ({
      productId: p.id,
      costCents: p.costCents,
      opening: prev ? opening.get(p.id) ?? null : null,
      received: sum(p.id, 'in'),
      waste: sum(p.id, 'waste'),
      sold: sum(p.id, 'sale'),
      sentOut: sum(p.id, 'out'),
      expected: p.onHand,
      counted: counts.get(p.id) ?? (uncountedAsZero ? 0 : null),
    })), await getUsesPos(db));

    for (const p of products) {
      const counted = counts.get(p.id) ?? (uncountedAsZero ? 0 : undefined);
      if (counted === undefined) continue;
      if (!counts.has(p.id)) await setCount(db, sessionId, p.id, 0);
      if (counted !== p.onHand) await applyDelta(db, p.id, 'count', counted - p.onHand, 'inventory', `Inventory #${sessionId}`);
    }
    const lastAfter = (await db.getFirstAsync<{ id: number | null }>('SELECT MAX(id) AS id FROM movements'))?.id ?? 0;
    await db.runAsync(
      `UPDATE inventory_sessions SET finished_at = datetime('now'), last_movement_id = ?, report = ? WHERE id = ?`,
      lastAfter, JSON.stringify(report), sessionId,
    );
  });
  return report;
}

/** Whether this bar sells through a POS. Defaults to yes. */
export async function getUsesPos(db: SQLiteDatabase): Promise<boolean> {
  return (await getSetting(db, 'bar.usesPos')) !== '0';
}

export async function setUsesPos(db: SQLiteDatabase, usesPos: boolean): Promise<void> {
  await setSetting(db, 'bar.usesPos', usesPos ? '1' : '0');
}

// ---- Staff ----

export interface Staff {
  id: number;
  name: string;
}

export async function listStaff(db: SQLiteDatabase): Promise<Staff[]> {
  return db.getAllAsync<Staff>('SELECT id, name FROM staff WHERE active = 1 ORDER BY name');
}

export async function addStaff(db: SQLiteDatabase, name: string): Promise<Staff> {
  const trimmed = name.trim();
  await db.runAsync(
    'INSERT INTO staff (name) VALUES (?) ON CONFLICT (name) DO UPDATE SET active = 1', trimmed,
  );
  return (await db.getFirstAsync<Staff>('SELECT id, name FROM staff WHERE name = ?', trimmed))!;
}

export async function removeStaff(db: SQLiteDatabase, id: number): Promise<void> {
  // Kept in the table so past waste still shows their name.
  await db.runAsync('UPDATE staff SET active = 0 WHERE id = ?', id);
  if ((await getCurrentStaffId(db)) === id) await db.runAsync("DELETE FROM settings WHERE key = 'staff.current'");
}

export async function getCurrentStaffId(db: SQLiteDatabase): Promise<number | null> {
  const v = await getSetting(db, 'staff.current');
  return v ? Number(v) : null;
}

export async function getCurrentStaff(db: SQLiteDatabase): Promise<Staff | null> {
  const id = await getCurrentStaffId(db);
  return id === null ? null : await db.getFirstAsync<Staff>('SELECT id, name FROM staff WHERE id = ? AND active = 1', id);
}

export async function setCurrentStaff(db: SQLiteDatabase, id: number): Promise<void> {
  await setSetting(db, 'staff.current', String(id));
}

/** Waste, comps and breakage logged in the last `hours`, with each entry's cost. */
export async function wasteSince(db: SQLiteDatabase, hours: number): Promise<{ entries: WasteEntry[]; names: Map<number, string> }> {
  const rows = await db.getAllAsync<{ staff_id: number | null; reason: WasteReason | null; bottles: number; cost_cents: number }>(
    `SELECT m.staff_id, m.reason, -m.bottles AS bottles, p.cost_cents
     FROM movements m JOIN products p ON p.id = m.product_id
     WHERE m.kind = 'waste' AND m.created_at >= datetime('now', ?)`,
    `-${hours} hours`,
  );
  const names = await db.getAllAsync<Staff>('SELECT id, name FROM staff');
  return {
    entries: rows.map(r => ({ staffId: r.staff_id, reason: r.reason, bottles: r.bottles, costCents: Math.round(r.bottles * r.cost_cents) })),
    names: new Map(names.map(n => [n.id, n.name])),
  };
}
