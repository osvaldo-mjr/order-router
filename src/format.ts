import type { RouteResult } from './types.ts';

export function formatLine(r: RouteResult): string {
  const notes = r.notes.map((n) => ` (${n})`).join('');
  return `${r.orderNumber.padEnd(6)} ${r.destination.padEnd(8)} ${r.reason}${notes}`;
}
