import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './cli.ts';
import { formatLine } from './format.ts';
import { buildOrders } from './normalize.ts';
import { disableWarehouses, routeOrders } from './router.ts';
import type { Catalog, OrderEvent, Warehouse, Zones } from './types.ts';

const root = join(import.meta.dirname, '..');
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(root, 'data', file), 'utf8'));

try {
  const warehouses = readJson('warehouses.json') as Warehouse[];
  const zones = readJson('zones.json') as Zones;
  const catalog = readJson('catalog.json') as Catalog;
  const events = readJson('orders.json') as OrderEvent[];

  const { off } = parseArgs(process.argv.slice(2), warehouses.map((w) => w.code));
  const { orders, warnings } = buildOrders(events, catalog);
  const results = routeOrders(orders, disableWarehouses(warehouses, off), zones);
  const text = results.map(formatLine).join('\n') + '\n';

  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  process.stdout.write(text);
  if (off.length > 0) {
    process.stderr.write(`(${off.join(', ')} turned off: routes.txt not written)\n`);
  } else {
    writeFileSync(join(root, 'routes.txt'), text);
  }
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
