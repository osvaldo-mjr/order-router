import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './cli.ts';
import { renderRoutes, type Inputs } from './pipeline.ts';

const root = join(import.meta.dirname, '..');

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

if (import.meta.main) {
  try {
    const inputs = loadInputs(join(root, 'data'));
    const { off } = parseArgs(process.argv.slice(2), inputs.warehouses.map((w) => w.code));
    const { text, warnings } = renderRoutes(inputs, off);

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
}
