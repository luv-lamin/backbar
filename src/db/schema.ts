import type { SQLiteDatabase } from 'expo-sqlite';

// Each entry runs once, in order. Never edit a shipped migration; add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upc TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    size_ml INTEGER NOT NULL DEFAULT 750,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    par REAL NOT NULL DEFAULT 0,
    on_hand REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('in','out','waste','sale','count')),
    bottles REAL NOT NULL,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'scan',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX movements_created ON movements(created_at DESC);
  CREATE TABLE recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    pos_item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (provider, pos_item_id)
  );
  CREATE TABLE recipe_pours (
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    oz REAL NOT NULL,
    PRIMARY KEY (recipe_id, product_id)
  );
  CREATE TABLE processed_sales (
    provider TEXT NOT NULL,
    sale_id TEXT NOT NULL,
    processed_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, sale_id)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  `
  CREATE TABLE inventory_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    -- Last movement included in this inventory's report; the next report starts after it.
    last_movement_id INTEGER,
    report TEXT
  );
  CREATE TABLE inventory_counts (
    session_id INTEGER NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    bottles REAL NOT NULL,
    PRIMARY KEY (session_id, product_id)
  );
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}
