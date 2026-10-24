import type { SQLiteDatabase } from 'expo-sqlite';
import { addProduct, findByUpc, recordMovement, upsertRecipe } from './repo';

// A small starter back bar so a new install has something to scan against.
const PRODUCTS = [
  { upc: '080480280024', name: "Tito's Handmade Vodka", category: 'Vodka', sizeMl: 750, costCents: 1950, par: 8, onHand: 6 },
  { upc: '811538010405', name: 'Espolòn Blanco Tequila', category: 'Tequila', sizeMl: 750, costCents: 2200, par: 6, onHand: 3.5 },
  { upc: '080686001409', name: 'Jameson Irish Whiskey', category: 'Whiskey', sizeMl: 750, costCents: 2400, par: 6, onHand: 4.25 },
  { upc: '082000727606', name: 'Bulleit Bourbon', category: 'Whiskey', sizeMl: 750, costCents: 2600, par: 4, onHand: 1.5 },
  { upc: '083664868766', name: 'Tanqueray London Dry Gin', category: 'Gin', sizeMl: 750, costCents: 2100, par: 4, onHand: 5 },
  { upc: '087000007307', name: 'Cointreau', category: 'Liqueur', sizeMl: 750, costCents: 3100, par: 2, onHand: 2 },
  { upc: '721059707504', name: 'Aperol', category: 'Liqueur', sizeMl: 750, costCents: 2300, par: 3, onHand: 0 },
];

const RECIPES: { name: string; pours: [string, number][] }[] = [
  { name: 'Margarita', pours: [['811538010405', 2], ['087000007307', 1]] },
  { name: "Tito's & Soda", pours: [['080480280024', 1.5]] },
  { name: 'Old Fashioned', pours: [['082000727606', 2]] },
  { name: 'Aperol Spritz', pours: [['721059707504', 2]] },
  { name: 'Gin & Tonic', pours: [['083664868766', 1.5]] },
];

export async function loadSampleBar(db: SQLiteDatabase): Promise<void> {
  for (const { onHand, ...p } of PRODUCTS) {
    if (await findByUpc(db, p.upc)) continue;
    const created = await addProduct(db, p);
    if (onHand > 0) await recordMovement(db, created.id, 'in', onHand, 'sample');
  }
  for (const r of RECIPES) {
    const pours = [];
    for (const [upc, oz] of r.pours) {
      const p = await findByUpc(db, upc);
      if (p) pours.push({ productId: p.id, oz });
    }
    // Keyed by name until the bar connects a POS and maps real catalog items.
    await upsertRecipe(db, 'square', `name:${r.name}`, r.name, pours);
  }
}
