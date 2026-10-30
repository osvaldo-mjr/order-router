import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildOrders, expandLines, normalizeCountry, normalizeSku, normalizeZip, parseTime } from '../src/normalize.ts';
import type { Catalog } from '../src/types.ts';

const catalog: Catalog = {
  products: [
    { sku: 'A', name: 'a', priceCents: 1 },
    { sku: 'B', name: 'b', priceCents: 1 },
  ],
  bundles: [{ sku: 'AB', name: 'ab', priceCents: 1, components: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 2 }] }],
};

describe('normalizeZip', () => {
  test('5-digit string is taken as-is, no note', () => {
    assert.deepEqual(normalizeZip('75201'), { zip: { kind: 'ok', zip: '75201', prefix: '752' }, note: undefined });
  });
  test('number that lost its leading zero is padded, with a note', () => {
    assert.deepEqual(normalizeZip(2134), { zip: { kind: 'ok', zip: '02134', prefix: '021' }, note: 'ZIP 2134 read as 02134' });
  });
  test('digit string with fewer than 5 digits is padded too', () => {
    assert.deepEqual(normalizeZip('501'), { zip: { kind: 'ok', zip: '00501', prefix: '005' }, note: 'ZIP 501 read as 00501' });
  });
  test('5-digit number needs no padding and no note', () => {
    assert.deepEqual(normalizeZip(75201).zip, { kind: 'ok', zip: '75201', prefix: '752' });
    assert.equal(normalizeZip(75201).note, undefined);
  });
  test('ZIP+4 uses the first three digits', () => {
    assert.deepEqual(normalizeZip('07030-1834').zip, { kind: 'ok', zip: '07030-1834', prefix: '070' });
  });
  test('surrounding whitespace is trimmed, with a note', () => {
    assert.equal(normalizeZip(' 07030 ').note, 'ZIP " 07030 " read as 07030');
  });
  test('missing, null and blank are missing', () => {
    for (const raw of [undefined, null, '', '   ']) assert.deepEqual(normalizeZip(raw).zip, { kind: 'missing' });
  });
  test('non-US formats are invalid', () => {
    assert.deepEqual(normalizeZip('M5V 2T6').zip, { kind: 'invalid', raw: 'M5V 2T6' });
    assert.equal(normalizeZip('123456').zip.kind, 'invalid');
  });
});

describe('normalizeSku / normalizeCountry / parseTime', () => {
  test('SKU is trimmed and uppercased, with a note only when it changed', () => {
    assert.deepEqual(normalizeSku('nw-mag-90'), { sku: 'NW-MAG-90', note: 'SKU nw-mag-90 read as NW-MAG-90' });
    assert.deepEqual(normalizeSku('NW-MAG-90'), { sku: 'NW-MAG-90' });
  });
  test('country is trimmed and uppercased; blank is null', () => {
    assert.deepEqual(normalizeCountry('us'), { country: 'US', note: 'country "us" read as US' });
    assert.deepEqual(normalizeCountry('US'), { country: 'US' });
    assert.deepEqual(normalizeCountry(''), { country: null });
    assert.deepEqual(normalizeCountry(undefined), { country: null });
  });
  test('parseTime returns null for missing, non-string or unparseable values', () => {
    assert.equal(parseTime('2026-01-01T10:00:00Z'), Date.parse('2026-01-01T10:00:00Z'));
    for (const raw of [undefined, null, '', 'yesterday', 1767261600000]) assert.equal(parseTime(raw), null);
  });
});

describe('expandLines', () => {
  test('bundles expand into components and quantities sum per SKU', () => {
    const r = expandLines([{ sku: 'AB', quantity: 2 }, { sku: 'b', quantity: 1 }], catalog);
    assert.deepEqual([...r.items], [['A', 2], ['B', 5]]);
    assert.deepEqual(r.unknownSkus, []);
    assert.equal(r.invalidQuantity, false);
    assert.deepEqual(r.notes, ['SKU b read as B']);
  });
  test('unknown SKUs are collected, not stocked', () => {
    const r = expandLines([{ sku: 'ZZZ', quantity: 1 }, { sku: 'A', quantity: 1 }], catalog);
    assert.deepEqual(r.unknownSkus, ['ZZZ']);
    assert.deepEqual([...r.items], [['A', 1]]);
  });
  test('a SKU that is not a string is unknown', () => {
    assert.deepEqual(expandLines([{ sku: 42, quantity: 1 }], catalog).unknownSkus, ['42']);
  });
  test('zero, negative, fractional, non-number and missing quantities are invalid', () => {
    for (const quantity of [0, -1, 1.5, '1', null, undefined, Number.NaN]) {
      const r = expandLines([{ sku: 'A', quantity }, { sku: 'AB', quantity }], catalog);
      assert.equal(r.invalidQuantity, true, `quantity ${String(quantity)}`);
      assert.equal(r.items.size, 0, `quantity ${String(quantity)} must not reach stock`);
    }
  });
});

const created = (orderNumber: string, at: unknown, lines: unknown[] = [{ sku: 'A', quantity: 1 }]) => ({
  type: 'order_created',
  orderNumber,
  at,
  shipTo: { country: 'US', zip: '07030' },
  lines,
});
const edited = (orderNumber: string, at: unknown, sku = 'B', quantity: unknown = 1) => ({
  type: 'order_edited',
  orderNumber,
  at,
  addedLines: [{ sku, quantity }],
});

describe('buildOrders', () => {
  test('orders are sorted by creation time, stable on ties', () => {
    const { orders } = buildOrders(
      [created('#3', '2026-01-01T10:05:00Z'), created('#1', '2026-01-01T10:00:00Z'), created('#2', '2026-01-01T10:05:00Z')],
      catalog,
    );
    assert.deepEqual(orders.map((o) => o.orderNumber), ['#1', '#3', '#2']);
  });
  test('an edit within 30 minutes is merged, with a note', () => {
    const { orders } = buildOrders([created('#1', '2026-01-01T10:00:00Z'), edited('#1', '2026-01-01T10:30:00Z', 'b')], catalog);
    assert.deepEqual([...orders[0].items], [['A', 1], ['B', 1]]);
    assert.deepEqual(orders[0].notes, ['SKU b read as B', 'edit merged: +1 B']);
  });
  test('an edit after 30 minutes is ignored, with a note', () => {
    const { orders } = buildOrders([created('#1', '2026-01-01T10:00:00Z'), edited('#1', '2026-01-01T10:31:00Z')], catalog);
    assert.deepEqual([...orders[0].items], [['A', 1]]);
    assert.deepEqual(orders[0].notes, ['edit ignored, 31 min after creation: +1 B']);
  });
  test('an edit listed before its order_created still applies', () => {
    const { orders } = buildOrders([edited('#1', '2026-01-01T10:10:00Z'), created('#1', '2026-01-01T10:00:00Z')], catalog);
    assert.deepEqual([...orders[0].items], [['A', 1], ['B', 1]]);
  });
  test('an edit for an unknown order, duplicates and unknown or malformed events become warnings', () => {
    const { orders, warnings } = buildOrders(
      [
        created('#1', '2026-01-01T10:00:00Z'),
        created('#1', '2026-01-01T10:01:00Z'),
        edited('#9', '2026-01-01T10:00:00Z'),
        { type: 'order_cancelled', orderNumber: '#1', at: '2026-01-01T10:02:00Z' },
        { type: 'order_edited', orderNumber: '#1', at: '2026-01-01T10:02:00Z' },
        null,
      ],
      catalog,
    );
    assert.equal(orders.length, 1);
    assert.deepEqual([...orders[0].items], [['A', 1]]);
    assert.equal(warnings.length, 5);
  });
  test('the ZIP fix note comes through to the order', () => {
    const { orders } = buildOrders([{ ...created('#1', '2026-01-01T10:00:00Z'), shipTo: { country: 'US', zip: 2134 } }], catalog);
    assert.deepEqual(orders[0].zip, { kind: 'ok', zip: '02134', prefix: '021' });
    assert.deepEqual(orders[0].notes, ['ZIP 2134 read as 02134']);
  });
  test('missing shipTo or lines do not crash', () => {
    const { orders } = buildOrders([{ type: 'order_created', orderNumber: '#1', at: '2026-01-01T10:00:00Z' }], catalog);
    assert.deepEqual(orders[0].zip, { kind: 'missing' });
    assert.equal(orders[0].country, null);
    assert.equal(orders[0].items.size, 0);
  });
});

describe('buildOrders: hold reasons', () => {
  test('an invalid quantity in a created line holds the order', () => {
    const { orders } = buildOrders([created('#1', '2026-01-01T10:00:00Z', [{ sku: 'A', quantity: -1 }])], catalog);
    assert.deepEqual(orders[0].holdReasons, ['invalid quantity']);
  });
  test('an invalid quantity in a merged edit holds the order', () => {
    const { orders } = buildOrders([created('#1', '2026-01-01T10:00:00Z'), edited('#1', '2026-01-01T10:05:00Z', 'B', 0)], catalog);
    assert.deepEqual(orders[0].holdReasons, ['invalid quantity']);
    assert.deepEqual(orders[0].notes, ['edit merged: +0 B']);
  });
  test('an invalid quantity in an ignored edit does not hold the order', () => {
    const { orders } = buildOrders([created('#1', '2026-01-01T10:00:00Z'), edited('#1', '2026-01-01T11:00:00Z', 'B', -3)], catalog);
    assert.deepEqual(orders[0].holdReasons, []);
    assert.deepEqual(orders[0].notes, ['edit ignored, 60 min after creation: -3 B']);
  });
  test('an unknown SKU holds the order', () => {
    const { orders } = buildOrders([created('#1', '2026-01-01T10:00:00Z', [{ sku: 'ZZZ', quantity: 1 }])], catalog);
    assert.deepEqual(orders[0].holdReasons, ['unknown SKU ZZZ']);
  });
  test('a missing or invalid created time holds the order and puts it after all timed orders', () => {
    const { orders } = buildOrders(
      [created('#1', undefined), created('#2', '2026-01-01T10:05:00Z'), created('#3', 'not a date'), created('#4', '2026-01-01T10:00:00Z')],
      catalog,
    );
    assert.deepEqual(orders.map((o) => o.orderNumber), ['#4', '#2', '#1', '#3']);
    assert.deepEqual(orders.map((o) => o.holdReasons), [[], [], ['invalid created time'], ['invalid created time']]);
  });
  test('edits to an order with no valid created time are not merged, with a note', () => {
    const { orders } = buildOrders([created('#1', 'bad'), edited('#1', '2026-01-01T10:05:00Z')], catalog);
    assert.deepEqual([...orders[0].items], [['A', 1]]);
    assert.deepEqual(orders[0].notes, ['edit ignored, created time unknown: +1 B']);
  });
  test('an edit with a missing or invalid time is ignored, with a note', () => {
    for (const at of [undefined, 'soon']) {
      const { orders } = buildOrders([created('#1', '2026-01-01T10:00:00Z'), edited('#1', at)], catalog);
      assert.deepEqual([...orders[0].items], [['A', 1]]);
      assert.deepEqual(orders[0].holdReasons, []);
      assert.deepEqual(orders[0].notes, ['edit ignored, invalid time: +1 B']);
    }
  });
  test('several hold reasons are all kept', () => {
    const { orders } = buildOrders([created('#1', 'bad', [{ sku: 'A', quantity: 0 }, { sku: 'ZZZ', quantity: 1 }])], catalog);
    assert.deepEqual(orders[0].holdReasons, ['invalid created time', 'invalid quantity', 'unknown SKU ZZZ']);
  });
});
