import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { applySales, getSetting, listProducts, listRecipes, setSetting, upsertRecipe } from '../db/repo';
import { clearCredentials, loadCredentials, PROVIDERS, saveCredentials, type PosCredentials } from '../pos';
import type { PosLocation } from '../pos/types';
import { square } from '../pos/square';
import { Button, Card, Field, Label, Title } from '../components/ui';
import { useColors } from '../theme';
import { useChanged, useQuery } from '../store';

const DAY_MS = 24 * 60 * 60 * 1000;

export function PosScreen() {
  const c = useColors();
  const recipes = useQuery(listRecipes, []);
  const [unmapped, setUnmapped] = useState<string[]>([]);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <SquareCard onUnmapped={setUnmapped} />

      {unmapped.length ? <MapItems names={unmapped} onDone={name => setUnmapped(u => u.filter(n => n !== name))} /> : null}

      <Card>
        <Title sub="Each POS menu item maps to the pours it uses. A 750 ml bottle is about 25.4 oz.">Recipes</Title>
        {recipes.length === 0 ? <Text style={{ color: c.muted }}>No recipes yet. After a sync, unmatched drinks show up here to map.</Text> : null}
        {recipes.map(r => (
          <View key={r.id} style={[styles.row, { borderColor: c.line }]}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{r.name}</Text>
            <Text style={{ color: c.muted }}>{r.pours.map(p => `${p.oz} oz ${p.productName}`).join(', ') || 'No pours'}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Title>More POS systems</Title>
        {PROVIDERS.filter(p => !p.available).map(p => (
          <View key={p.id} style={[styles.row, { borderColor: c.line, flexDirection: 'row', justifyContent: 'space-between' }]}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{p.name}</Text>
            <Text style={{ color: c.muted }}>Coming soon</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function SquareCard({ onUnmapped }: { onUnmapped: (names: string[]) => void }) {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const [creds, setCreds] = useState<PosCredentials | null>(null);
  const [token, setToken] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [locations, setLocations] = useState<PosLocation[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    loadCredentials('square').then(setCreds);
    getSetting(db, 'square.lastSync').then(setLastSync);
  }, [db]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try { await task(); } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const connect = () => run(async () => {
    const draft = { accessToken: token.trim(), sandbox };
    const locs = await square.listLocations(draft);
    if (!locs.length) throw new Error('No active locations on this Square account.');
    if (locs.length === 1) return choose(draft, locs[0]);
    setLocations(locs);
    setCreds(null);
  });

  async function choose(draft: PosCredentials, loc: PosLocation) {
    const next = { ...draft, locationId: loc.id };
    await saveCredentials('square', next);
    setCreds(next);
    setLocations([]);
    setToken('');
    setStatus(`Connected to ${loc.name}.`);
  }

  const sync = () => run(async () => {
    if (!creds) return;
    const startedAt = new Date().toISOString();
    const since = lastSync ?? new Date(Date.now() - DAY_MS).toISOString();
    const sales = await square.fetchSales(creds, since);
    const { applied, unmapped } = await applySales(db, 'square', sales);
    await setSetting(db, 'square.lastSync', startedAt);
    setLastSync(startedAt);
    onUnmapped(unmapped);
    setStatus(`Pulled ${applied} new order${applied === 1 ? '' : 's'}.${unmapped.length ? ` ${unmapped.length} item${unmapped.length === 1 ? '' : 's'} need a recipe.` : ''}`);
    changed();
  });

  const disconnect = () => run(async () => {
    await clearCredentials('square');
    setCreds(null);
  });

  return (
    <Card>
      <Title sub="Sales come in from Square and the pours are taken out of stock.">Square</Title>
      {creds ? (
        <>
          <Text style={{ color: c.ok, fontWeight: '600' }}>Connected{creds.sandbox ? ' (sandbox)' : ''}</Text>
          <Text style={{ color: c.muted }}>{lastSync ? `Last pulled ${new Date(lastSync).toLocaleString()}` : 'Not pulled yet. The first pull covers the last 24 hours.'}</Text>
          <Button kind="primary" title={busy ? 'Pulling…' : 'Pull latest sales'} disabled={busy} onPress={sync} />
          <Button kind="danger" title="Disconnect" disabled={busy} onPress={disconnect} />
        </>
      ) : locations.length ? (
        <>
          <Label>Choose a location</Label>
          {locations.map(l => (
            <Button key={l.id} title={l.name} onPress={() => run(() => choose({ accessToken: token.trim(), sandbox }, l))} />
          ))}
        </>
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Label>Access token</Label>
            <Field value={token} onChangeText={setToken} placeholder="From developer.squareup.com" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: c.ink }}>Sandbox (test data)</Text>
            <Switch value={sandbox} onValueChange={setSandbox} />
          </View>
          <Button kind="primary" title={busy ? 'Connecting…' : 'Connect Square'} disabled={busy || !token.trim()} onPress={connect} />
        </>
      )}
      {status ? <Text style={{ color: c.muted }}>{status}</Text> : null}
    </Card>
  );
}

function MapItems({ names, onDone }: { names: string[]; onDone: (name: string) => void }) {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const products = useQuery(listProducts, []);
  const [name, setName] = useState(names[0]);
  const [productId, setProductId] = useState<number | null>(null);
  const [oz, setOz] = useState('1.5');
  const current = names.includes(name) ? name : names[0];

  async function save() {
    if (!productId) return;
    // Unmapped items are reported by display name; the next sync matches on it.
    await upsertRecipe(db, 'square', `name:${current}`, current, [{ productId, oz: parseFloat(oz) || 1.5 }]);
    setProductId(null);
    onDone(current);
    changed();
  }

  return (
    <Card>
      <Title sub="These items sold but don't have a recipe, so no stock was taken out for them.">Needs a recipe</Title>
      <View style={styles.chips}>
        {names.map(n => <Button key={n} title={n} kind={n === current ? 'primary' : 'plain'} onPress={() => setName(n)} />)}
      </View>
      <Label>Main pour for {current}</Label>
      <View style={styles.chips}>
        {products.map(p => <Button key={p.id} title={p.name} kind={p.id === productId ? 'primary' : 'plain'} onPress={() => setProductId(p.id)} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <View style={{ width: 90, gap: 6 }}><Label>Ounces</Label><Field value={oz} onChangeText={setOz} keyboardType="decimal-pad" /></View>
        <Button style={{ flex: 1 }} kind="primary" title="Save recipe" disabled={!productId} onPress={save} />
      </View>
      <Text style={{ color: c.muted, fontSize: 12 }}>Not a drink (food, merch)? Leave it; it won't affect stock.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  row: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
