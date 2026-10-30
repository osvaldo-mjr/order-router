import type { Catalog, Order, OrderCreated, OrderEdited, OrderEvent, RawLine, ZipResult } from './types.ts';

export const EDIT_WINDOW_MS = 30 * 60 * 1000;

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
  const sku = String(raw).trim().toUpperCase();
  return sku === raw ? { sku } : { sku, note: `SKU ${raw} read as ${sku}` };
}

export function normalizeCountry(raw: unknown): { country: string | null; note?: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { country: null };
  const country = raw.trim().toUpperCase();
  return country === raw ? { country } : { country, note: `country "${raw}" read as ${country}` };
}

// Expands bundles into their components and sums quantities per SKU.
export function expandLines(
  lines: RawLine[],
  catalog: Catalog,
): { items: Map<string, number>; unknownSkus: string[]; notes: string[] } {
  const products = new Set(catalog.products.map((p) => normalizeSku(p.sku).sku));
  const bundles = new Map(catalog.bundles.map((b) => [normalizeSku(b.sku).sku, b.components]));
  const items = new Map<string, number>();
  const unknownSkus: string[] = [];
  const notes: string[] = [];
  const add = (sku: string, qty: number) => items.set(sku, (items.get(sku) ?? 0) + qty);

  for (const line of lines) {
    const { sku, note } = normalizeSku(line.sku);
    if (note && !notes.includes(note)) notes.push(note);
    const components = bundles.get(sku);
    if (components) {
      for (const c of components) add(normalizeSku(c.sku).sku, c.quantity * line.quantity);
    } else if (products.has(sku)) {
      add(sku, line.quantity);
    } else if (!unknownSkus.includes(sku)) {
      unknownSkus.push(sku);
    }
  }
  return { items, unknownSkus, notes };
}

function describeLines(lines: RawLine[]): string {
  return lines.map((l) => `+${l.quantity} ${normalizeSku(l.sku).sku}`).join(', ');
}

// Turns the event stream into one Order per order_created, sorted by creation
// time (stable, so equal timestamps keep file order). Edits within the window
// are merged into their order; anything else becomes a warning or a note.
export function buildOrders(events: OrderEvent[], catalog: Catalog): { orders: Order[]; warnings: string[] } {
  const warnings: string[] = [];
  const created = new Map<string, OrderCreated>();
  const edits = new Map<string, OrderEdited[]>();

  for (const event of events) {
    if (event.type === 'order_created') {
      const e = event as OrderCreated;
      if (created.has(e.orderNumber)) warnings.push(`duplicate order_created for ${e.orderNumber} ignored`);
      else created.set(e.orderNumber, e);
    } else if (event.type === 'order_edited') {
      const e = event as OrderEdited;
      edits.set(e.orderNumber, [...(edits.get(e.orderNumber) ?? []), e]);
    } else {
      warnings.push(`unknown event type "${event.type}" ignored`);
    }
  }
  for (const orderNumber of edits.keys()) {
    if (!created.has(orderNumber)) warnings.push(`order_edited for unknown order ${orderNumber} ignored`);
  }

  const sorted = [...created.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const orders = sorted.map((c): Order => {
    const notes: string[] = [];
    const zip = normalizeZip(c.shipTo?.zip);
    if (zip.note) notes.push(zip.note);
    const country = normalizeCountry(c.shipTo?.country);
    if (country.note) notes.push(country.note);

    const lines = [...c.lines];
    const editNotes: string[] = [];
    const orderEdits = [...(edits.get(c.orderNumber) ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (const edit of orderEdits) {
      const delay = Date.parse(edit.at) - Date.parse(c.at);
      if (delay >= 0 && delay <= EDIT_WINDOW_MS) {
        lines.push(...edit.addedLines);
        editNotes.push(`edit merged: ${describeLines(edit.addedLines)}`);
      } else {
        editNotes.push(`edit ignored, ${Math.round(delay / 60000)} min after creation: ${describeLines(edit.addedLines)}`);
      }
    }

    const expanded = expandLines(lines, catalog);
    notes.push(...expanded.notes, ...editNotes);

    return {
      orderNumber: c.orderNumber,
      createdAt: c.at,
      country: country.country,
      zip: zip.zip,
      items: expanded.items,
      unknownSkus: expanded.unknownSkus,
      notes,
    };
  });

  return { orders, warnings };
}
