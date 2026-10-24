import type { Sale } from '../db/repo';
import { PosError, type PosCredentials, type PosLocation, type PosProvider } from './types';

// Square Orders API: https://developer.squareup.com/reference/square/orders-api/search-orders
const BASE = 'https://connect.squareup.com/v2';
const SANDBOX_BASE = 'https://connect.squareupsandbox.com/v2';
const SQUARE_VERSION = '2024-10-17';

interface SquareLineItem {
  uid?: string;
  name?: string;
  quantity: string;
  catalog_object_id?: string;
}

interface SquareOrder {
  id: string;
  line_items?: SquareLineItem[];
}

async function call<T>(creds: PosCredentials, path: string, body?: unknown): Promise<T> {
  const res = await fetch((creds.sandbox ? SANDBOX_BASE : BASE) + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail ?? `HTTP ${res.status}`;
    throw new PosError(res.status === 401 ? 'Square rejected the access token. Check it and try again.' : `Square: ${detail}`);
  }
  return json as T;
}

/** Maps a Square order to a normalized sale. Exported for tests. */
export function toSale(order: SquareOrder): Sale {
  return {
    id: order.id,
    lines: (order.line_items ?? []).map(li => ({
      // Catalog id is stable across renames; fall back to the name for custom amounts.
      posItemId: li.catalog_object_id ?? `name:${li.name ?? 'Custom amount'}`,
      name: li.name ?? 'Custom amount',
      quantity: Number(li.quantity) || 0,
    })),
  };
}

export const square: PosProvider = {
  id: 'square',
  name: 'Square',
  available: true,

  async listLocations(creds) {
    const json = await call<{ locations?: { id: string; name: string; status: string }[] }>(creds, '/locations');
    return (json.locations ?? []).filter(l => l.status === 'ACTIVE').map<PosLocation>(l => ({ id: l.id, name: l.name }));
  },

  async fetchSales(creds, since) {
    if (!creds.locationId) throw new PosError('Choose a Square location first.');
    const sales: Sale[] = [];
    let cursor: string | undefined;
    do {
      const json = await call<{ orders?: SquareOrder[]; cursor?: string }>(creds, '/orders/search', {
        location_ids: [creds.locationId],
        limit: 500,
        cursor,
        query: {
          filter: {
            state_filter: { states: ['COMPLETED'] },
            date_time_filter: { closed_at: { start_at: since } },
          },
          sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' },
        },
      });
      sales.push(...(json.orders ?? []).map(toSale));
      cursor = json.cursor;
    } while (cursor);
    return sales;
  },
};
