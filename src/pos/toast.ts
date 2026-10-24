import type { Sale } from '../db/repo';
import { PosError, type PosCredentials, type PosProvider } from './types';

// Toast Standard API access: a restaurant creates credentials in Toast Web under
// Integrations > Toast API access > Manage credentials, with orders read access.
// https://doc.toasttab.com/doc/devguide/apiOrdersGetDetailedInfoAboutMultipleOrders.html
const DEFAULT_URL = 'https://ws-api.toasttab.com';
const PAGE_SIZE = 100;

interface ToastSelection {
  item?: { guid?: string };
  displayName?: string;
  quantity?: number;
  voided?: boolean;
}

interface ToastOrder {
  guid: string;
  voided?: boolean;
  deleted?: boolean;
  checks?: { voided?: boolean; deleted?: boolean; selections?: ToastSelection[] }[];
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

function baseUrl(creds: PosCredentials): string {
  return (creds.apiUrl?.trim() || DEFAULT_URL).replace(/\/+$/, '');
}

async function authToken(creds: PosCredentials): Promise<string> {
  if (!creds.clientId || !creds.clientSecret) throw new PosError('Enter the Toast client ID and client secret.');
  const key = `${baseUrl(creds)}|${creds.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${baseUrl(creds)}/authentication/v1/authentication/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' }),
  });
  const json = await res.json().catch(() => ({}));
  const token = json?.token?.accessToken;
  if (!res.ok || !token) throw new PosError('Toast rejected the client ID or secret. Check them and try again.');
  tokens.set(key, { token, expiresAt: Date.now() + (Number(json.token.expiresIn) || 3600) * 1000 });
  return token;
}

async function call<T>(creds: PosCredentials, path: string): Promise<{ json: T; hasNext: boolean }> {
  if (!creds.locationId) throw new PosError('Enter the restaurant GUID from your Toast credentials email.');
  const res = await fetch(baseUrl(creds) + path, {
    headers: {
      Authorization: `Bearer ${await authToken(creds)}`,
      'Toast-Restaurant-External-ID': creds.locationId,
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new PosError("Toast refused access. Check the restaurant GUID and that the credentials can read orders.");
    throw new PosError(`Toast: HTTP ${res.status}`);
  }
  // Pages are linked with RFC 5988 headers; there is no "last" link, so follow "next".
  return { json: (await res.json()) as T, hasNext: /rel="?next"?/.test(res.headers.get('link') ?? '') };
}

/** Maps a Toast order to a normalized sale, skipping voided and deleted parts. Exported for tests. */
export function toSale(order: ToastOrder): Sale {
  const lines = (order.checks ?? [])
    .filter(ch => !ch.voided && !ch.deleted)
    .flatMap(ch => ch.selections ?? [])
    .filter(s => !s.voided)
    .map(s => ({
      posItemId: s.item?.guid ?? `name:${s.displayName ?? 'Open item'}`,
      name: s.displayName ?? 'Open item',
      quantity: Number(s.quantity) || 0,
    }));
  return { id: order.guid, lines };
}

export const toast: PosProvider = {
  id: 'toast',
  name: 'Toast',
  available: true,
  help: 'In Toast Web, go to Integrations > Toast API access > Manage credentials and create Standard API credentials that can read orders. The restaurant GUID is in the confirmation email.',
  fields: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'locationId', label: 'Restaurant GUID' },
    { key: 'apiUrl', label: 'API access URL', placeholder: DEFAULT_URL, optional: true },
  ],

  async listLocations(creds) {
    const { json } = await call<{ general?: { name?: string; locationName?: string } }>(
      creds, `/restaurants/v1/restaurants/${encodeURIComponent(creds.locationId ?? '')}`,
    );
    return [{ id: creds.locationId!, name: json.general?.locationName || json.general?.name || 'Toast restaurant' }];
  },

  async fetchSales(creds, since) {
    const end = new Date().toISOString();
    const sales: Sale[] = [];
    for (let page = 1; ; page++) {
      const q = `startDate=${encodeURIComponent(since)}&endDate=${encodeURIComponent(end)}&pageSize=${PAGE_SIZE}&page=${page}`;
      const { json, hasNext } = await call<ToastOrder[]>(creds, `/orders/v2/ordersBulk?${q}`);
      sales.push(...json.filter(o => !o.voided && !o.deleted).map(toSale));
      if (!hasNext || json.length < PAGE_SIZE) break;
    }
    return sales;
  },
};
