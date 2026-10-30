import { isRecord } from './normalize.ts';
import type { Order, RouteResult, Warehouse, Zones } from './types.ts';

export const PRIORITY = ['WH-NJ', 'WH-GA', 'WH-NV', 'WH-TX'];

// Zones are looked up by warehouse code, so keys like "_note" are never read.
export function zoneFor(zones: Zones, code: string, prefix: string): number | undefined {
  const table = zones[code];
  if (!isRecord(table)) return undefined;
  const zone = table[prefix];
  return typeof zone === 'number' ? zone : undefined;
}

export function hasStock(wh: Warehouse, items: Map<string, number>): boolean {
  for (const [sku, qty] of items) {
    if ((wh.inventory[sku]?.available ?? 0) < qty) return false;
  }
  return true;
}

// Smallest available / dailyVelocity over the order's SKUs, using stock
// before this order is reserved. Velocity 0 means the stock never runs out.
export function daysOfCover(wh: Warehouse, items: Map<string, number>): number {
  let cover = Infinity;
  for (const sku of items.keys()) {
    const entry = wh.inventory[sku];
    if (!entry) return 0;
    const days = entry.dailyVelocity > 0 ? entry.available / entry.dailyVelocity : Infinity;
    cover = Math.min(cover, days);
  }
  return cover;
}

function priorityRank(code: string): number {
  const i = PRIORITY.indexOf(code);
  return i === -1 ? PRIORITY.length : i;
}

export type Candidate = { wh: Warehouse; zone: number; cover: number };

// Negative when a is better than b, 0 when they tie.
export type Ranking = { name: string; compare: (a: Candidate, b: Candidate) => number };

// Rules 4-6, applied in order: each one only breaks ties left by the ones before it.
export const RANKING: Ranking[] = [
  { name: 'zone', compare: (a, b) => a.zone - b.zone },
  { name: 'cover', compare: (a, b) => (a.cover === b.cover ? 0 : a.cover > b.cover ? -1 : 1) },
  { name: 'priority', compare: (a, b) => priorityRank(a.wh.code) - priorityRank(b.wh.code) || a.wh.code.localeCompare(b.wh.code) },
];

// Narrows the candidates one ranking at a time and reports which ranking
// decided. 'zone' deciding is the normal case; later ones are tie-breaks.
export function pickBest(candidates: Candidate[], ranking: Ranking[]): { best: Candidate; decidedBy: string | null } {
  let remaining = candidates;
  for (const { name, compare } of ranking) {
    if (remaining.length === 1) break;
    const top = remaining.reduce((a, b) => (compare(b, a) < 0 ? b : a));
    remaining = remaining.filter((c) => compare(c, top) === 0);
    if (remaining.length === 1) return { best: remaining[0], decidedBy: name };
  }
  return { best: remaining[0], decidedBy: null };
}

export function chooseWarehouse(order: Order, warehouses: Warehouse[], zones: Zones, ranking: Ranking[] = RANKING): RouteResult {
  const result = (destination: string, reason: string, extra: string[] = []): RouteResult => ({
    orderNumber: order.orderNumber,
    destination,
    reason,
    notes: [...extra, ...order.notes],
  });

  if (order.holdReasons.length > 0) return result('HOLD', order.holdReasons.join('; '));
  if (order.items.size === 0) return result('HOLD', 'no items');
  if (order.country === null) return result('HOLD', 'missing country');

  // Rule 1
  if (order.country !== 'US') return result('PARTNER', `outside US (country ${order.country})`);

  // Rule 2
  if (order.zip.kind === 'missing') return result('PARTNER', 'no ZIP');
  if (order.zip.kind === 'invalid') return result('PARTNER', `invalid ZIP ${order.zip.raw}`);
  const prefix = order.zip.prefix;
  if (!warehouses.some((wh) => zoneFor(zones, wh.code, prefix) !== undefined)) {
    return result('PARTNER', `ZIP prefix ${prefix} not in zones`);
  }

  // Rule 3
  const candidates: Candidate[] = [];
  for (const wh of warehouses) {
    const zone = zoneFor(zones, wh.code, prefix);
    if (wh.enabled && zone !== undefined && hasStock(wh, order.items)) {
      candidates.push({ wh, zone, cover: daysOfCover(wh, order.items) });
    }
  }

  // Rule 7
  if (candidates.length === 0) return result('PARTNER', 'no warehouse can take the whole order');

  // Rules 4-6
  const { best, decidedBy } = pickBest(candidates, ranking);
  const tieNote = decidedBy !== null && decidedBy !== ranking[0].name ? [`tie: ${decidedBy}`] : [];
  return result(best.wh.code, `zone ${best.zone}`, tieNote);
}

// Returns copies with the given warehouses disabled. Input is not changed.
export function disableWarehouses(warehouses: Warehouse[], codes: string[]): Warehouse[] {
  return warehouses.map((wh) => (codes.includes(wh.code) ? { ...wh, enabled: false } : wh));
}

// Routes orders in sequence. Each routed order reserves its stock on a
// private copy, so later orders see less. The input warehouses are not changed.
export function routeOrders(orders: Order[], warehouses: Warehouse[], zones: Zones, ranking: Ranking[] = RANKING): RouteResult[] {
  const state: Warehouse[] = warehouses.map((wh) => ({
    ...wh,
    inventory: Object.fromEntries(Object.entries(wh.inventory).map(([sku, e]) => [sku, { ...e }])),
  }));

  return orders.map((order) => {
    const route = chooseWarehouse(order, state, zones, ranking);
    const wh = state.find((w) => w.code === route.destination);
    if (wh) {
      for (const [sku, qty] of order.items) wh.inventory[sku].available -= qty;
    }
    return route;
  });
}
