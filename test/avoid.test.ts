import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { avoidRule, chooseWarehouse, RANKING, routeOrders } from '../src/router.ts';
import type { Order, Warehouse, Zones } from '../src/types.ts';

// Every warehouse has plenty of A; GA has the most cover, so the normal
// rules pick GA whenever GA shares the lowest zone.
const wh = (code: string, available = 10): Warehouse => ({
  code,
  city: code,
  enabled: true,
  inventory: { A: { available, dailyVelocity: 1 } },
});
const GA = () => wh('WH-GA', 100);

const order: Order = {
  orderNumber: '#1',
  country: 'US',
  zip: { kind: 'ok', zip: '11111', prefix: '111' },
  items: new Map([['A', 1]]),
  holdReasons: [],
  notes: [],
};

const zonesOf = (z: Record<string, number>): Zones => Object.fromEntries(Object.entries(z).map(([code, zone]) => [code, { '111': zone }]));

const AVOID_GA = [avoidRule('WH-GA'), ...RANKING];
const route = (whs: Warehouse[], z: Record<string, number>, ranking = AVOID_GA) => {
  const r = chooseWarehouse(order, whs, zonesOf(z), ranking);
  return [r.destination, r.reason, r.notes];
};

describe('avoidRule', () => {
  test('another warehouse in the same zone takes the order, with a note', () => {
    const z = { 'WH-GA': 3, 'WH-NJ': 3 };
    assert.deepEqual(route([GA(), wh('WH-NJ')], z, RANKING), ['WH-GA', 'zone 3', ['tie: cover']]);
    assert.deepEqual(route([GA(), wh('WH-NJ')], z), ['WH-NJ', 'zone 3', ['avoided WH-GA at zone 3']]);
  });

  test('another warehouse one zone farther takes the order, with a note', () => {
    const z = { 'WH-GA': 3, 'WH-NJ': 4 };
    assert.deepEqual(route([GA(), wh('WH-NJ')], z, RANKING), ['WH-GA', 'zone 3', []]);
    assert.deepEqual(route([GA(), wh('WH-NJ')], z), ['WH-NJ', 'zone 4', ['avoided WH-GA at zone 3']]);
  });

  test('another warehouse two zones farther does not; normal rules decide', () => {
    assert.deepEqual(route([GA(), wh('WH-NJ')], { 'WH-GA': 3, 'WH-NJ': 5 }), ['WH-GA', 'zone 3', []]);
  });

  test('the avoided warehouse as the only candidate still takes the order', () => {
    // NJ is within one zone but has no stock, so it is not a candidate.
    assert.deepEqual(route([GA(), wh('WH-NJ', 0)], { 'WH-GA': 3, 'WH-NJ': 3 }), ['WH-GA', 'zone 3', []]);
    assert.deepEqual(route([GA()], { 'WH-GA': 3 }), ['WH-GA', 'zone 3', []]);
  });

  test('no avoided warehouse among the candidates: same result as the normal rules', () => {
    const z = { 'WH-GA': 1, 'WH-NJ': 3, 'WH-NV': 3 };
    const whs = [{ ...GA(), enabled: false }, wh('WH-NJ', 5), wh('WH-NV', 50)];
    assert.deepEqual(route(whs, z), route(whs, z, RANKING));
    assert.deepEqual(route(whs, z), ['WH-NV', 'zone 3', ['tie: cover']]);
  });

  test('no note when the normal rules already pick another warehouse', () => {
    assert.deepEqual(route([GA(), wh('WH-NJ')], { 'WH-GA': 3, 'WH-NJ': 2 }), ['WH-NJ', 'zone 2', []]);
  });

  test('after avoiding, the normal tie-breaks decide among the rest, with both notes', () => {
    const z = { 'WH-GA': 3, 'WH-NJ': 4, 'WH-NV': 4 };
    assert.deepEqual(route([GA(), wh('WH-NJ', 5), wh('WH-NV', 50)], z), ['WH-NV', 'zone 4', ['tie: cover', 'avoided WH-GA at zone 3']]);
  });

  test('the result does not depend on the order of the warehouses', () => {
    // A pairwise-only rule would let the zone-6 warehouse "tie" with GA and
    // keep GA in play. The rule must look at all candidates.
    const z = { 'WH-GA': 3, 'WH-NJ': 4, 'WH-TX': 6 };
    const whs = [GA(), wh('WH-NJ'), wh('WH-TX')];
    for (const perm of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      assert.deepEqual(route(perm.map((i) => whs[i]), z), ['WH-NJ', 'zone 4', ['avoided WH-GA at zone 3']], `order ${perm}`);
    }
  });

  test('routeOrders reserves stock at the warehouse the rule picked', () => {
    const z = zonesOf({ 'WH-GA': 3, 'WH-NJ': 4 });
    const whs = [GA(), wh('WH-NJ', 1)];
    const results = routeOrders([{ ...order, orderNumber: '#1' }, { ...order, orderNumber: '#2' }], whs, z, AVOID_GA);
    // #1 takes NJ's only unit, so #2 has no other candidate and goes to GA.
    assert.deepEqual(results.map((r) => r.destination), ['WH-NJ', 'WH-GA']);
  });
});
