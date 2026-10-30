import type { Order, RouteResult, Warehouse, Zones } from './types.ts';

export const PRIORITY = ['WH-NJ', 'WH-GA', 'WH-NV', 'WH-TX'];

// Zones are looked up by warehouse code, so keys like "_note" are never read.
export function zoneFor(zones: Zones, code: string, prefix: string): number | undefined {
  const table = zones[code];
  if (typeof table !== 'object' || table === null) return undefined;
  const zone = (table as Record<string, unknown>)[prefix];
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

export function chooseWarehouse(order: Order, warehouses: Warehouse[], zones: Zones): RouteResult {
  const result = (destination: string, reason: string, extra: string[] = []): RouteResult => ({
    orderNumber: order.orderNumber,
    destination,
    reason,
    notes: [...extra, ...order.notes],
  });

  if (order.unknownSkus.length > 0) return result('HOLD', `unknown SKU ${order.unknownSkus.join(', ')}`);
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
  const candidates = warehouses
    .filter((wh) => wh.enabled && hasStock(wh, order.items))
    .map((wh) => ({ wh, zone: zoneFor(zones, wh.code, prefix) }))
    .filter((c): c is { wh: Warehouse; zone: number } => c.zone !== undefined);

  // Rule 7
  if (candidates.length === 0) return result('PARTNER', 'no warehouse can take the whole order');

  // Rule 4
  const bestZone = Math.min(...candidates.map((c) => c.zone));
  const byZone = candidates.filter((c) => c.zone === bestZone);
  const reason = `zone ${bestZone}`;
  if (byZone.length === 1) return result(byZone[0].wh.code, reason);

  // Rule 5
  const covered = byZone.map((c) => ({ ...c, cover: daysOfCover(c.wh, order.items) }));
  const bestCover = Math.max(...covered.map((c) => c.cover));
  const byCover = covered.filter((c) => c.cover === bestCover);
  if (byCover.length === 1) return result(byCover[0].wh.code, reason, ['tie: cover']);

  // Rule 6
  const [first] = byCover.sort((a, b) => priorityRank(a.wh.code) - priorityRank(b.wh.code));
  return result(first.wh.code, reason, ['tie: priority']);
}

// Returns copies with the given warehouses disabled. Input is not changed.
export function disableWarehouses(warehouses: Warehouse[], codes: string[]): Warehouse[] {
  return warehouses.map((wh) => (codes.includes(wh.code) ? { ...wh, enabled: false } : wh));
}

// Routes orders in sequence. Each routed order reserves its stock on a
// private copy, so later orders see less. The input warehouses are not changed.
export function routeOrders(orders: Order[], warehouses: Warehouse[], zones: Zones): RouteResult[] {
  const state: Warehouse[] = warehouses.map((wh) => ({
    ...wh,
    inventory: Object.fromEntries(Object.entries(wh.inventory).map(([sku, e]) => [sku, { ...e }])),
  }));

  return orders.map((order) => {
    const route = chooseWarehouse(order, state, zones);
    const wh = state.find((w) => w.code === route.destination);
    if (wh) {
      for (const [sku, qty] of order.items) wh.inventory[sku].available -= qty;
    }
    return route;
  });
}
