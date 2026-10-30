import { formatLine } from './format.ts';
import { buildOrders } from './normalize.ts';
import { avoidRule, disableWarehouses, RANKING, routeOrders } from './router.ts';
import type { Catalog, Warehouse, Zones } from './types.ts';

export type Inputs = { warehouses: Warehouse[]; zones: Zones; catalog: Catalog; events: unknown[] };

// The whole run from parsed inputs to routes.txt text, with no file access.
export function renderRoutes(inputs: Inputs, off: string[] = [], avoid: string | null = null): { text: string; warnings: string[] } {
  const { orders, warnings } = buildOrders(inputs.events, inputs.catalog);
  const ranking = avoid ? [avoidRule(avoid), ...RANKING] : RANKING;
  const results = routeOrders(orders, disableWarehouses(inputs.warehouses, off), inputs.zones, ranking);
  return { text: results.map(formatLine).join('\n') + '\n', warnings };
}
