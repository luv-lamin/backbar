/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  affectsStock,
  bottlesToReorder,
  clampDelta,
  depletionsForSale,
  movementDelta,
  normalizeBarcode,
  ozToBottles,
  stockStatus,
  stockTakeReport,
  variance,
} from './inventory.ts';

test('Out lowers stock only for bars without a POS', () => {
  assert.equal(affectsStock('out', true), false);
  assert.equal(affectsStock('out', false), true);
  assert.equal(affectsStock('in', true), true);
});

test('stockStatus flags low and out', () => {
  assert.equal(stockStatus({ onHand: 0, par: 3 }), 'out');
  assert.equal(stockStatus({ onHand: 2.5, par: 3 }), 'low');
  assert.equal(stockStatus({ onHand: 3, par: 3 }), 'ok');
});

test('a 750 ml bottle holds about 25.4 oz', () => {
  assert.ok(Math.abs(ozToBottles(25.36, 750) - 1) < 0.001);
});

test('movementDelta signs by kind and rejects bad quantities', () => {
  assert.equal(movementDelta('in', 6), 6);
  assert.equal(movementDelta('out', 1), -1);
  assert.equal(movementDelta('waste', 0.25), -0.25);
  assert.throws(() => movementDelta('in', 0));
  assert.throws(() => movementDelta('in', Number.NaN));
});

test('clampDelta never takes stock below zero', () => {
  assert.equal(clampDelta(1.5, -3), -1.5);
  assert.equal(clampDelta(1.5, 2), 2);
});

test('depletionsForSale sums pours across lines and reports unmapped items', () => {
  const recipes = new Map([
    ['marg', [{ productId: 1, oz: 2 }, { productId: 2, oz: 1 }]],
    ['shot', [{ productId: 1, oz: 1.5 }]],
  ]);
  const products = new Map([
    [1, { sizeMl: 750 }],
    [2, { sizeMl: 750 }],
  ]);
  const { depletions, unmapped } = depletionsForSale(
    [
      { posItemId: 'marg', name: 'Margarita', quantity: 3 },
      { posItemId: 'shot', name: 'Tequila shot', quantity: 2 },
      { posItemId: 'fries', name: 'Fries', quantity: 1 },
    ],
    recipes,
    products,
  );
  assert.ok(Math.abs(depletions.get(1)! - ozToBottles(9, 750)) < 1e-9);
  assert.ok(Math.abs(depletions.get(2)! - ozToBottles(3, 750)) < 1e-9);
  assert.deepEqual(unmapped.map(l => l.name), ['Fries']);
});

test('depletionsForSale falls back to a recipe keyed by item name', () => {
  const recipes = new Map([['name:Margarita', [{ productId: 1, oz: 2 }]]]);
  const { depletions, unmapped } = depletionsForSale(
    [{ posItemId: 'SQ-VAR-123', name: 'Margarita', quantity: 1 }],
    recipes,
    new Map([[1, { sizeMl: 750 }]]),
  );
  assert.ok(depletions.has(1));
  assert.equal(unmapped.length, 0);
});

test('variance is counted minus expected, costed', () => {
  const row = variance({ id: 1, onHand: 4.25, costCents: 2400 }, 3.75);
  assert.equal(row.variance, -0.5);
  assert.equal(row.costCents, -1200);
});

test('bottlesToReorder rounds up to whole bottles', () => {
  assert.equal(bottlesToReorder({ onHand: 1.5, par: 4 }), 3);
  assert.equal(bottlesToReorder({ onHand: 5, par: 4 }), 0);
});

test('normalizeBarcode strips the EAN-13 leading zero from UPC-A', () => {
  assert.equal(normalizeBarcode('0080480280024'), '080480280024');
  assert.equal(normalizeBarcode(' 080480280024 '), '080480280024');
  assert.equal(normalizeBarcode('5012345678900'), '5012345678900');
});

test('stockTakeReport compares counts with the system and with sales', () => {
  const report = stockTakeReport([
    // Opened with 4, received 6, POS says 3 sold and 0.5 wasted: expect 6.5. Counted 5.5.
    { productId: 1, costCents: 2000, opening: 4, received: 6, waste: 0.5, sold: 3, sentOut: 2, expected: 6.5, counted: 5.5 },
    // Matches exactly.
    { productId: 2, costCents: 1000, opening: 2, received: 0, waste: 0, sold: 1, sentOut: 0, expected: 1, counted: 1 },
    // Not counted.
    { productId: 3, costCents: 3000, opening: null, received: 0, waste: 0, sold: 0, sentOut: 0, expected: 2, counted: null },
  ]);
  const [a, b, c] = report.rows;
  assert.equal(a.variance, -1);
  assert.equal(a.varianceCents, -2000);
  assert.equal(a.actualUsage, 4.5);
  assert.equal(a.recordedUsage, 3.5);
  assert.equal(b.variance, 0);
  assert.equal(c.variance, null);
  assert.equal(report.counted, 2);
  assert.equal(report.uncounted, 1);
  assert.equal(report.shortfallCents, 2000);
  // Recorded (3.5×20 + 1×10 = 80) over actual (4.5×20 + 1×10 = 100).
  assert.ok(Math.abs(report.salesAccuracy! - 0.8) < 1e-9);
});

test('stockTakeReport has no sales accuracy on the first inventory', () => {
  const report = stockTakeReport([
    { productId: 1, costCents: 2000, opening: null, received: 0, waste: 0, sold: 0, sentOut: 0, expected: 3, counted: 3 },
  ]);
  assert.equal(report.salesAccuracy, null);
  assert.equal(report.rows[0].actualUsage, null);
});

test('without a POS, bottles sent out count as used', () => {
  const report = stockTakeReport([
    // Opened 4, received 6, sent 4 to the bar, wasted 0.5: expect 5.5. Counted 5, so 5 used vs 4.5 recorded.
    { productId: 1, costCents: 2000, opening: 4, received: 6, waste: 0.5, sold: 0, sentOut: 4, expected: 5.5, counted: 5 },
  ], false);
  assert.equal(report.rows[0].recordedUsage, 4.5);
  assert.equal(report.rows[0].actualUsage, 5);
  assert.ok(Math.abs(report.salesAccuracy! - 0.9) < 1e-9);
  assert.equal(report.usesPos, false);
});
