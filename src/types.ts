// Raw input shapes, as they appear in data/*.json.

export type RawLine = { sku: string; quantity: number };

export type OrderCreated = {
  type: 'order_created';
  orderNumber: string;
  at: string;
  shipTo: { country?: unknown; state?: unknown; zip?: unknown };
  lines: RawLine[];
};

export type OrderEdited = {
  type: 'order_edited';
  orderNumber: string;
  at: string;
  addedLines: RawLine[];
};

export type OrderEvent = OrderCreated | OrderEdited | { type: string; orderNumber?: string; at?: string };

export type StockEntry = { available: number; dailyVelocity: number };

export type Warehouse = {
  code: string;
  city: string;
  enabled: boolean;
  inventory: Record<string, StockEntry>;
};

// zones.json also holds a "_note" string, so values are not all tables.
export type Zones = Record<string, unknown>;

export type Catalog = {
  products: { sku: string; name: string; priceCents: number }[];
  bundles: { sku: string; name: string; priceCents: number; components: RawLine[] }[];
};

// Normalized shapes, used by the router.

export type ZipResult =
  | { kind: 'ok'; zip: string; prefix: string }
  | { kind: 'missing' }
  | { kind: 'invalid'; raw: string };

export type Order = {
  orderNumber: string;
  createdAt: string;
  country: string | null;
  zip: ZipResult;
  items: Map<string, number>; // SKU -> quantity, bundles expanded
  unknownSkus: string[];
  notes: string[]; // every fix applied to the input, shown in routes.txt
};

export type RouteResult = {
  orderNumber: string;
  destination: string; // warehouse code, 'PARTNER' or 'HOLD'
  reason: string;
  notes: string[];
};
