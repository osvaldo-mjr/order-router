import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { chooseWarehouse, daysOfCover, disableWarehouses, routeOrders } from '../src/router.ts';
import type { Order, Warehouse, Zones } from '../src/types.ts';

const wh = (code: string, stock: Record<string, [number, number]>, enabled = true): Warehouse => ({
  code,
  city: code,
  enabled,
  inventory: Object.fromEntries(Object.entries(stock).map(([sku, [available, dailyVelocity]]) => [sku, { available, dailyVelocity }])),
});

const order = (items: Record<string, number>, over: Partial<Order> = {}): Order => ({
  orderNumber: '#1',
  createdAt: '2026-01-01T10:00:00Z',
  country: 'US',
  zip: { kind: 'ok', zip: '11111', prefix: '111' },
  items: new Map(Object.entries(items)),
  unknownSkus: [],
  notes: [],
  ...over,
});

const zones: Zones = {
  _note: 'not a warehouse',
  'WH-NJ': { '111': 2 },
  'WH-GA': { '111': 1 },
  'WH-NV': { '111': 1 },
  'WH-TX': { '111': 1 },
};

describe('chooseWarehouse', () => {
  test('unknown SKU goes to HOLD, even for an international order', () => {
    const r = chooseWarehouse(order({ A: 1 }, { unknownSkus: ['ZZZ'], country: 'CA' }), [wh('WH-NJ', { A: [9, 1] })], zones);
    assert.deepEqual([r.destination, r.reason], ['HOLD', 'unknown SKU ZZZ']);
  });
  test('missing country goes to HOLD', () => {
    assert.equal(chooseWarehouse(order({ A: 1 }, { country: null }), [wh('WH-NJ', { A: [9, 1] })], zones).destination, 'HOLD');
  });
  test('rule 1: outside the US goes to PARTNER', () => {
    const r = chooseWarehouse(order({ A: 1 }, { country: 'CA' }), [wh('WH-NJ', { A: [9, 1] })], zones);
    assert.deepEqual([r.destination, r.reason], ['PARTNER', 'outside US (country CA)']);
  });
  test('rule 2: no ZIP, invalid ZIP, or prefix not in zones goes to PARTNER', () => {
    const whs = [wh('WH-NJ', { A: [9, 1] })];
    assert.equal(chooseWarehouse(order({ A: 1 }, { zip: { kind: 'missing' } }), whs, zones).reason, 'no ZIP');
    assert.equal(chooseWarehouse(order({ A: 1 }, { zip: { kind: 'invalid', raw: 'X1' } }), whs, zones).reason, 'invalid ZIP X1');
    const r = chooseWarehouse(order({ A: 1 }, { zip: { kind: 'ok', zip: '96815', prefix: '968' } }), whs, zones);
    assert.deepEqual([r.destination, r.reason], ['PARTNER', 'ZIP prefix 968 not in zones']);
  });
  test('rule 3: disabled warehouses and short stock are skipped; orders are not split', () => {
    const whs = [wh('WH-GA', { A: [9, 1], B: [0, 1] }), wh('WH-NV', { A: [9, 1], B: [9, 1] }, false), wh('WH-NJ', { A: [1, 1], B: [1, 1] })];
    const r = chooseWarehouse(order({ A: 1, B: 1 }), whs, zones);
    assert.deepEqual([r.destination, r.reason], ['WH-NJ', 'zone 2']);
  });
  test('rule 3: a warehouse with no zone for the prefix is skipped', () => {
    const r = chooseWarehouse(order({ A: 1 }), [wh('WH-XX', { A: [9, 1] }), wh('WH-NJ', { A: [9, 1] })], zones);
    assert.equal(r.destination, 'WH-NJ');
  });
  test('rule 4: lowest zone wins, no tie note', () => {
    const r = chooseWarehouse(order({ A: 1 }), [wh('WH-NJ', { A: [99, 1] }), wh('WH-GA', { A: [1, 1] })], zones);
    assert.deepEqual([r.destination, r.reason, r.notes], ['WH-GA', 'zone 1', []]);
  });
  test('rule 5: zone tie goes to most days of cover (smallest per SKU)', () => {
    // GA cover = min(10/1, 2/1) = 2. NV cover = min(3/1, 30/10) = 3.
    const whs = [wh('WH-GA', { A: [10, 1], B: [2, 1] }), wh('WH-NV', { A: [3, 1], B: [30, 10] })];
    const r = chooseWarehouse(order({ A: 1, B: 1 }), whs, zones);
    assert.deepEqual([r.destination, r.notes], ['WH-NV', ['tie: cover']]);
  });
  test('rule 6: cover tie goes by priority NJ, GA, NV, TX', () => {
    const whs = [wh('WH-TX', { A: [5, 1] }), wh('WH-NV', { A: [5, 1] })];
    const r = chooseWarehouse(order({ A: 1 }), whs, zones);
    assert.deepEqual([r.destination, r.notes], ['WH-NV', ['tie: priority']]);
  });
  test('rule 7: nobody can take it goes to PARTNER', () => {
    const r = chooseWarehouse(order({ A: 5 }), [wh('WH-NJ', { A: [4, 1] })], zones);
    assert.deepEqual([r.destination, r.reason], ['PARTNER', 'no warehouse can take the whole order']);
  });
  test('order notes follow the tie note', () => {
    const whs = [wh('WH-TX', { A: [5, 1] }), wh('WH-NV', { A: [5, 1] })];
    const r = chooseWarehouse(order({ A: 1 }, { notes: ['ZIP 2134 read as 02134'] }), whs, zones);
    assert.deepEqual(r.notes, ['tie: priority', 'ZIP 2134 read as 02134']);
  });
});

describe('daysOfCover', () => {
  test('velocity 0 means infinite cover', () => {
    assert.equal(daysOfCover(wh('WH-TX', { A: [5, 0] }), new Map([['A', 1]])), Infinity);
  });
  test('uses stock before the reservation', () => {
    assert.equal(daysOfCover(wh('WH-NJ', { A: [10, 4] }), new Map([['A', 2]])), 2.5);
  });
});

describe('routeOrders', () => {
  test('each routed order reserves stock, so later orders see less', () => {
    const whs = [wh('WH-GA', { A: [2, 1] }), wh('WH-NJ', { A: [9, 1] })];
    const results = routeOrders([order({ A: 2 }, { orderNumber: '#1' }), order({ A: 1 }, { orderNumber: '#2' })], whs, zones);
    assert.deepEqual(results.map((r) => r.destination), ['WH-GA', 'WH-NJ']);
  });
  test('PARTNER and HOLD orders reserve nothing', () => {
    const whs = [wh('WH-GA', { A: [1, 1] })];
    const results = routeOrders(
      [order({ A: 1 }, { orderNumber: '#1', country: 'CA' }), order({ A: 1 }, { orderNumber: '#2' })],
      whs,
      zones,
    );
    assert.deepEqual(results.map((r) => r.destination), ['PARTNER', 'WH-GA']);
  });
  test('input warehouses are not changed', () => {
    const whs = [wh('WH-GA', { A: [2, 1] })];
    routeOrders([order({ A: 2 })], whs, zones);
    assert.equal(whs[0].inventory.A.available, 2);
  });
  test('disableWarehouses turns off the given codes on copies only', () => {
    const whs = [wh('WH-GA', { A: [2, 1] }), wh('WH-NJ', { A: [9, 1] })];
    const off = disableWarehouses(whs, ['WH-GA']);
    assert.deepEqual(off.map((w) => w.enabled), [false, true]);
    assert.equal(whs[0].enabled, true);
    assert.equal(routeOrders([order({ A: 1 })], off, zones)[0].destination, 'WH-NJ');
  });
});
