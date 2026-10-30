// Raw input shapes, as they appear in data/*.json. Fields that can be messy
// are `unknown` and are checked in normalize.ts.

export type RawLine = { sku: unknown; quantity: unknown };

export type OrderCreated = {
  type: 'order_created';
  orderNumber: string;
  at?: unknown;
  shipTo?: unknown;
  lines?: unknown;
};

export type OrderEdited = {
  type: 'order_edited';
  orderNumber: string;
  at?: unknown;
  addedLines: unknown[];
};

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
  bundles: { sku: string; name: string; priceCents: number; components: { sku: string; quantity: number }[] }[];
};

// Normalized shapes, used by the router.

export type ZipResult =
  | { kind: 'ok'; zip: string; prefix: string }
  | { kind: 'missing' }
  | { kind: 'invalid'; raw: string };

export type Order = {
  orderNumber: string;
  country: string | null;
  zip: ZipResult;
  items: Map<string, number>; // SKU -> quantity, bundles expanded
  holdReasons: string[]; // non-empty means the order goes to HOLD
  notes: string[]; // every fix applied to the input, shown in routes.txt
};

export type RouteResult = {
  orderNumber: string;
  destination: string; // warehouse code, 'PARTNER' or 'HOLD'
  reason: string;
  notes: string[];
};
