import type { Catalog, Order, OrderCreated, OrderEdited, RawLine, ZipResult } from './types.ts';

export const EDIT_WINDOW_MS = 30 * 60 * 1000;

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isOrderCreated(x: unknown): x is OrderCreated {
  return isRecord(x) && x.type === 'order_created' && typeof x.orderNumber === 'string';
}

export function isOrderEdited(x: unknown): x is OrderEdited {
  return isRecord(x) && x.type === 'order_edited' && typeof x.orderNumber === 'string' && Array.isArray(x.addedLines);
}

// Milliseconds since epoch, or null when "at" is missing or not a date.
export function parseTime(at: unknown): number | null {
  if (typeof at !== 'string') return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

export function isValidQuantity(q: unknown): q is number {
  return typeof q === 'number' && Number.isInteger(q) && q > 0;
}

export function readLines(raw: unknown): RawLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((line: unknown) => (isRecord(line) ? { sku: line.sku, quantity: line.quantity } : { sku: undefined, quantity: undefined }));
}

// A ZIP of 1-4 digits lost its leading zeros (2134 or "2134" -> "02134").
// 5 digits or ZIP+4 are taken as-is. Anything else is invalid.
export function normalizeZip(raw: unknown): { zip: ZipResult; note?: string } {
  if (raw === undefined || raw === null) return { zip: { kind: 'missing' } };

  let text: string;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) text = String(raw);
  else if (typeof raw === 'string') text = raw.trim();
  else return { zip: { kind: 'invalid', raw: String(raw) } };

  if (text === '') return { zip: { kind: 'missing' } };

  if (/^\d{1,4}$/.test(text)) {
    const zip = text.padStart(5, '0');
    return { zip: { kind: 'ok', zip, prefix: zip.slice(0, 3) }, note: `ZIP ${String(raw)} read as ${zip}` };
  }
  if (/^\d{5}(-\d{4})?$/.test(text)) {
    const note = typeof raw === 'string' && raw !== text ? `ZIP "${raw}" read as ${text}` : undefined;
    return { zip: { kind: 'ok', zip: text, prefix: text.slice(0, 3) }, note };
  }
  return { zip: { kind: 'invalid', raw: text } };
}

export function normalizeSku(raw: string): { sku: string; note?: string } {
  const sku = raw.trim().toUpperCase();
  return sku === raw ? { sku } : { sku, note: `SKU ${raw} read as ${sku}` };
}

export function normalizeCountry(raw: unknown): { country: string | null; note?: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { country: null };
  const country = raw.trim().toUpperCase();
  return country === raw ? { country } : { country, note: `country "${raw}" read as ${country}` };
}

// Expands bundles into their components and sums quantities per SKU.
// Lines with a bad quantity or an unknown SKU are left out and reported.
export function expandLines(
  lines: RawLine[],
  catalog: Catalog,
): { items: Map<string, number>; invalidQuantity: boolean; unknownSkus: string[]; notes: string[] } {
  const products = new Set(catalog.products.map((p) => normalizeSku(p.sku).sku));
  const bundles = new Map(catalog.bundles.map((b) => [normalizeSku(b.sku).sku, b.components]));
  const items = new Map<string, number>();
  const unknownSkus: string[] = [];
  const notes: string[] = [];
  let invalidQuantity = false;
  const add = (sku: string, qty: number) => items.set(sku, (items.get(sku) ?? 0) + qty);

  for (const line of lines) {
    if (typeof line.sku !== 'string') {
      const sku = String(line.sku);
      if (!unknownSkus.includes(sku)) unknownSkus.push(sku);
      continue;
    }
    const { sku, note } = normalizeSku(line.sku);
    if (note && !notes.includes(note)) notes.push(note);
    const quantity = line.quantity;
    if (!isValidQuantity(quantity)) {
      invalidQuantity = true;
      continue;
    }
    const components = bundles.get(sku);
    if (components) {
      for (const c of components) add(normalizeSku(c.sku).sku, c.quantity * quantity);
    } else if (products.has(sku)) {
      add(sku, quantity);
    } else if (!unknownSkus.includes(sku)) {
      unknownSkus.push(sku);
    }
  }
  return { items, invalidQuantity, unknownSkus, notes };
}

function describeLines(lines: RawLine[]): string {
  return lines
    .map((l) => {
      const sku = typeof l.sku === 'string' ? normalizeSku(l.sku).sku : String(l.sku);
      const qty = typeof l.quantity === 'number' && l.quantity >= 0 ? `+${l.quantity}` : String(l.quantity);
      return `${qty} ${sku}`;
    })
    .join(', ');
}

// Turns the event stream into one Order per order_created. Orders are sorted
// by creation time (stable, so equal timestamps keep file order); orders with
// no valid creation time go last, in file order, and are held. Edits within
// the window are merged into their order; anything else becomes a note or a
// warning.
export function buildOrders(events: unknown[], catalog: Catalog): { orders: Order[]; warnings: string[] } {
  const warnings: string[] = [];
  const created = new Map<string, OrderCreated>();
  const edits = new Map<string, OrderEdited[]>();

  for (const event of events) {
    if (isOrderCreated(event)) {
      if (created.has(event.orderNumber)) warnings.push(`duplicate order_created for ${event.orderNumber} ignored`);
      else created.set(event.orderNumber, event);
    } else if (isOrderEdited(event)) {
      edits.set(event.orderNumber, [...(edits.get(event.orderNumber) ?? []), event]);
    } else {
      const type = isRecord(event) ? String(event.type) : typeof event;
      warnings.push(`unrecognized or malformed event "${type}" ignored`);
    }
  }
  for (const orderNumber of edits.keys()) {
    if (!created.has(orderNumber)) warnings.push(`order_edited for unknown order ${orderNumber} ignored`);
  }

  const timed = [...created.values()].map((c) => ({ c, ms: parseTime(c.at) }));
  const queue = [
    ...timed.filter((t) => t.ms !== null).sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0)),
    ...timed.filter((t) => t.ms === null),
  ];

  const orders = queue.map(({ c, ms: createdMs }): Order => {
    const notes: string[] = [];
    const holdReasons: string[] = [];
    if (createdMs === null) holdReasons.push('invalid created time');

    const shipTo = isRecord(c.shipTo) ? c.shipTo : {};
    const zip = normalizeZip(shipTo.zip);
    if (zip.note) notes.push(zip.note);
    const country = normalizeCountry(shipTo.country);
    if (country.note) notes.push(country.note);

    const lines = readLines(c.lines);
    const editNotes: string[] = [];
    const orderEdits = (edits.get(c.orderNumber) ?? [])
      .map((e) => ({ e, ms: parseTime(e.at) }))
      .sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
    for (const { e, ms } of orderEdits) {
      const added = readLines(e.addedLines);
      if (ms === null) {
        editNotes.push(`edit ignored, invalid time: ${describeLines(added)}`);
      } else if (createdMs === null) {
        editNotes.push(`edit ignored, created time unknown: ${describeLines(added)}`);
      } else if (ms - createdMs >= 0 && ms - createdMs <= EDIT_WINDOW_MS) {
        lines.push(...added);
        editNotes.push(`edit merged: ${describeLines(added)}`);
      } else {
        editNotes.push(`edit ignored, ${Math.round((ms - createdMs) / 60000)} min after creation: ${describeLines(added)}`);
      }
    }

    const expanded = expandLines(lines, catalog);
    notes.push(...expanded.notes, ...editNotes);
    if (expanded.invalidQuantity) holdReasons.push('invalid quantity');
    if (expanded.unknownSkus.length > 0) holdReasons.push(`unknown SKU ${expanded.unknownSkus.join(', ')}`);

    return {
      orderNumber: c.orderNumber,
      country: country.country,
      zip: zip.zip,
      items: expanded.items,
      holdReasons,
      notes,
    };
  });

  return { orders, warnings };
}
