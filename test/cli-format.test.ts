import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseArgs } from '../src/cli.ts';
import { formatLine } from '../src/format.ts';

const codes = ['WH-NJ', 'WH-GA', 'WH-NV'];
const offOnly = (off: string[]) => ({ off, avoid: null });

describe('parseArgs', () => {
  test('no args means nothing is turned off', () => {
    assert.deepEqual(parseArgs([], codes), offOnly([]));
  });
  test('--off accepts a code, a comma list, the = form, and repeats', () => {
    assert.deepEqual(parseArgs(['--off', 'WH-NV'], codes), offOnly(['WH-NV']));
    assert.deepEqual(parseArgs(['--off', 'WH-NV,wh-ga'], codes), offOnly(['WH-NV', 'WH-GA']));
    assert.deepEqual(parseArgs(['--off=WH-NV', '--off', 'WH-NV'], codes), offOnly(['WH-NV']));
  });
  test('unknown codes, missing values and unknown args are errors', () => {
    assert.throws(() => parseArgs(['--off', 'WH-XX'], codes), /unknown warehouse/);
    assert.throws(() => parseArgs(['--off'], codes), /needs warehouse codes/);
    assert.throws(() => parseArgs(['--on', 'WH-NV'], codes), /unknown argument/);
  });
  test('--avoid takes one warehouse and combines with --off', () => {
    assert.deepEqual(parseArgs(['--avoid', 'wh-ga'], codes), { off: [], avoid: 'WH-GA' });
    assert.deepEqual(parseArgs(['--off', 'WH-NV', '--avoid=WH-GA'], codes), { off: ['WH-NV'], avoid: 'WH-GA' });
    assert.throws(() => parseArgs(['--avoid', 'WH-GA,WH-NJ'], codes), /one warehouse/);
    assert.throws(() => parseArgs(['--avoid', 'WH-XX'], codes), /unknown warehouse/);
    assert.throws(() => parseArgs(['--avoid'], codes), /--avoid needs warehouse codes/);
  });
});

describe('formatLine', () => {
  test('order, destination, reason, then each note in parentheses', () => {
    const line = formatLine({ orderNumber: '#2033', destination: 'WH-NJ', reason: 'zone 3', notes: ['tie: cover', 'ZIP 2134 read as 02134'] });
    assert.equal(line, '#2033  WH-NJ    zone 3 (tie: cover) (ZIP 2134 read as 02134)');
  });
});
