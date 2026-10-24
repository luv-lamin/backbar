import type { Sale } from '../db/repo';

export type ProviderId = 'square' | 'toast' | 'clover' | 'lightspeed';

export interface PosCredentials {
  accessToken: string;
  locationId?: string;
  /** Use the provider's test environment instead of live data. */
  sandbox?: boolean;
}

export interface PosLocation {
  id: string;
  name: string;
}

/**
 * Every POS integration implements this. The rest of the app only sees
 * normalized `Sale`s, so adding a POS never touches inventory code.
 */
export interface PosProvider {
  id: ProviderId;
  name: string;
  /** False until the integration is built. The UI shows it as coming soon. */
  available: boolean;
  listLocations(creds: PosCredentials): Promise<PosLocation[]>;
  /** Completed sales closed at or after `since` (ISO 8601). */
  fetchSales(creds: PosCredentials, since: string): Promise<Sale[]>;
}

export class PosError extends Error {}
