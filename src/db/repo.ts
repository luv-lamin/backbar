import type { SQLiteDatabase } from 'expo-sqlite';
import {
  clampDelta,
  depletionsForSale,
  type MovementKind,
  type Product,
  type RecipePour,
  type SaleLine,
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
): Promise<number> {
  let onHand = 0;
  await db.withTransactionAsync(async () => {
    onHand = await applyDelta(db, productId, kind, delta, source, note);
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
): Promise<number> {
  const row = await db.getFirstAsync<{ on_hand: number }>('SELECT on_hand FROM products WHERE id = ?', productId);
  if (!row) throw new Error('Product not found');
  const applied = clampDelta(row.on_hand, delta);
  const onHand = row.on_hand + applied;
  await db.runAsync('UPDATE products SET on_hand = ? WHERE id = ?', onHand, productId);
  await db.runAsync(
    'INSERT INTO movements (product_id, kind, bottles, source, note) VALUES (?, ?, ?, ?, ?)',
    productId, kind, applied, source, note,
  );
  return onHand;
}

/** Sets counted stock for several products at once (end-of-shift count). */
export async function saveCount(db: SQLiteDatabase, counts: Map<number, number>): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [productId, counted] of counts) {
      const row = await db.getFirstAsync<{ on_hand: number }>('SELECT on_hand FROM products WHERE id = ?', productId);
      if (!row) continue;
      const delta = counted - row.on_hand;
      if (delta !== 0) await applyDelta(db, productId, 'count', delta, 'count', null);
    }
  });
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

export interface Sale {
  id: string;
  lines: SaleLine[];
}

/**
 * Deducts POS sales from stock using recipes. Each sale is applied at most once,
 * so pulling the same window twice is safe. Returns item names with no recipe.
 */
export async function applySales(db: SQLiteDatabase, provider: string, sales: Sale[]): Promise<{ applied: number; unmapped: string[] }> {
  const recipes = new Map<string, RecipePour[]>();
  for (const r of await listRecipes(db)) if (r.provider === provider) recipes.set(r.posItemId, r.pours);
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
