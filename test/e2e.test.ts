import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadInputs } from '../src/load.ts';
import { renderRoutes } from '../src/pipeline.ts';

// The fixture is the hand-checked output. It is compared against a fresh run,
// never against routes.txt, which npm start rewrites.
test('routing the files in data/ gives the checked output', () => {
  const root = join(import.meta.dirname, '..');
  const expected = readFileSync(join(root, 'test', 'fixtures', 'expected-routes.txt'), 'utf8');
  const { text, warnings } = renderRoutes(loadInputs(join(root, 'data')));
  assert.equal(text, expected);
  assert.deepEqual(warnings, []);
});
