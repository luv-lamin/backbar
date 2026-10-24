import * as SecureStore from 'expo-secure-store';
import { square } from './square';
import { toast } from './toast';
import { PosError, type PosCredentials, type PosProvider, type ProviderId } from './types';

const comingSoon = (id: ProviderId, name: string): PosProvider => ({
  id,
  name,
  available: false,
  listLocations: async () => { throw new PosError(`${name} is not supported yet.`); },
  fetchSales: async () => { throw new PosError(`${name} is not supported yet.`); },
});

// Lightspeed needs partner approval; Clover needs an App Market listing.
export const PROVIDERS: PosProvider[] = [
  square,
  toast,
  comingSoon('clover', 'Clover'),
  comingSoon('lightspeed', 'Lightspeed'),
];

const key = (id: ProviderId) => `pos.${id}.credentials`;

export async function loadCredentials(id: ProviderId): Promise<PosCredentials | null> {
  const raw = await SecureStore.getItemAsync(key(id));
  return raw ? (JSON.parse(raw) as PosCredentials) : null;
}

export async function saveCredentials(id: ProviderId, creds: PosCredentials): Promise<void> {
  await SecureStore.setItemAsync(key(id), JSON.stringify(creds));
}

export async function clearCredentials(id: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(key(id));
}

export { PosError };
export type { PosCredentials, PosProvider, ProviderId };
