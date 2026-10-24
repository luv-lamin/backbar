import type { Sale } from '../db/repo';

export type ProviderId = 'square' | 'toast' | 'clover' | 'lightspeed';

export interface PosCredentials {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  apiUrl?: string;
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
  /** Where the bar finds its credentials. */
  help?: string;
  /** What the connect form asks for. */
  fields?: PosField[];
  /** Offers a test-data switch on the connect form. */
  sandbox?: boolean;
  listLocations(creds: PosCredentials): Promise<PosLocation[]>;
  /** Completed sales closed at or after `since` (ISO 8601). */
  fetchSales(creds: PosCredentials, since: string): Promise<Sale[]>;
}

export interface PosField {
  key: 'accessToken' | 'clientId' | 'clientSecret' | 'apiUrl' | 'locationId';
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
}

export class PosError extends Error {}
