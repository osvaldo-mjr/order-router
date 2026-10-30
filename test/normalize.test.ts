import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildOrders, expandLines, normalizeCountry, normalizeSku, normalizeZip } from '../src/normalize.ts';
import type { Catalog, OrderEvent } from '../src/types.ts';

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

describe('normalizeSku / normalizeCountry', () => {
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
});

describe('expandLines', () => {
  test('bundles expand into components and quantities sum per SKU', () => {
    const r = expandLines([{ sku: 'AB', quantity: 2 }, { sku: 'b', quantity: 1 }], catalog);
    assert.deepEqual([...r.items], [['A', 2], ['B', 5]]);
    assert.deepEqual(r.unknownSkus, []);
    assert.deepEqual(r.notes, ['SKU b read as B']);
  });
  test('unknown SKUs are collected, not stocked', () => {
    const r = expandLines([{ sku: 'ZZZ', quantity: 1 }, { sku: 'A', quantity: 1 }], catalog);
    assert.deepEqual(r.unknownSkus, ['ZZZ']);
    assert.deepEqual([...r.items], [['A', 1]]);
  });
});

const created = (orderNumber: string, at: string, lines = [{ sku: 'A', quantity: 1 }]): OrderEvent => ({
  type: 'order_created',
  orderNumber,
  at,
  shipTo: { country: 'US', zip: '07030' },
  lines,
});
const edited = (orderNumber: string, at: string, sku = 'B'): OrderEvent => ({
  type: 'order_edited',
  orderNumber,
  at,
  addedLines: [{ sku, quantity: 1 }],
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
  test('an edit for an unknown order, duplicates and unknown event types become warnings', () => {
    const { orders, warnings } = buildOrders(
      [
        created('#1', '2026-01-01T10:00:00Z'),
        created('#1', '2026-01-01T10:01:00Z'),
        edited('#9', '2026-01-01T10:00:00Z'),
        { type: 'order_cancelled', orderNumber: '#1', at: '2026-01-01T10:02:00Z' },
      ],
      catalog,
    );
    assert.equal(orders.length, 1);
    assert.equal(warnings.length, 3);
  });
  test('the ZIP fix note comes through to the order', () => {
    const e = { ...(created('#1', '2026-01-01T10:00:00Z') as object), shipTo: { country: 'US', zip: 2134 } } as OrderEvent;
    const { orders } = buildOrders([e], catalog);
    assert.deepEqual(orders[0].zip, { kind: 'ok', zip: '02134', prefix: '021' });
    assert.deepEqual(orders[0].notes, ['ZIP 2134 read as 02134']);
  });
});
