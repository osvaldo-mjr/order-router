import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Inputs } from './pipeline.ts';

export function loadInputs(dataDir: string): Inputs {
  const readJson = (file: string): unknown => JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  const events = readJson('orders.json');
  if (!Array.isArray(events)) throw new Error('orders.json must be an array of events');
  return {
    warehouses: readJson('warehouses.json') as Inputs['warehouses'],
    zones: readJson('zones.json') as Inputs['zones'],
    catalog: readJson('catalog.json') as Inputs['catalog'],
    events,
  };
}
