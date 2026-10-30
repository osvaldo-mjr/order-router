import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './cli.ts';
import { loadInputs } from './load.ts';
import { renderRoutes } from './pipeline.ts';

const root = join(import.meta.dirname, '..');

try {
  const inputs = loadInputs(join(root, 'data'));
  const { off, avoid } = parseArgs(process.argv.slice(2), inputs.warehouses.map((w) => w.code));
  const { text, warnings } = renderRoutes(inputs, off, avoid);

  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  process.stdout.write(text);
  const whatIf = [...(off.length > 0 ? [`${off.join(', ')} turned off`] : []), ...(avoid ? [`avoiding ${avoid}`] : [])];
  if (whatIf.length > 0) {
    process.stderr.write(`(${whatIf.join('; ')}: routes.txt not written)\n`);
  } else {
    writeFileSync(join(root, 'routes.txt'), text);
  }
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
