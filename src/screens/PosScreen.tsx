import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { ANY_POS, applySales, getSetting, getUsesPos, listProducts, listRecipes, setSetting, setUsesPos, upsertRecipe } from '../db/repo';
import { clearCredentials, loadCredentials, PROVIDERS, saveCredentials, type PosCredentials } from '../pos';
import type { PosField, PosLocation, PosProvider } from '../pos/types';
import { Button, Card, Field, Label, Title } from '../components/ui';
import { useColors } from '../theme';
import { useChanged, useQuery } from '../store';

const DAY_MS = 24 * 60 * 60 * 1000;

export function PosScreen() {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const usesPos = useQuery(getUsesPos, true);
  const recipes = useQuery(listRecipes, []);
  const [unmapped, setUnmapped] = useState<string[]>([]);

  const modeCard = (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ color: c.ink, flex: 1, fontWeight: '600' }}>This bar uses a POS system</Text>
        <Switch value={usesPos} onValueChange={v => setUsesPos(db, v).then(changed)} accessibilityLabel="This bar uses a POS system" />
      </View>
      <Text style={{ color: c.muted }}>
        {usesPos
          ? 'Sales from your POS take poured liquor out of stock. Scanning a bottle Out just records that it went to the bar.'
          : 'No POS: scanning a bottle Out counts it as used and takes it out of stock. Inventory reports compare your count with what was scanned out.'}
      </Text>
    </Card>
  );

  if (!usesPos) {
    return <ScrollView contentContainerStyle={styles.page}>{modeCard}</ScrollView>;
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {modeCard}

      {PROVIDERS.filter(p => p.available).map(p => (
        <ProviderCard key={p.id} provider={p} onUnmapped={names => setUnmapped(u => [...new Set([...u, ...names])])} />
      ))}

      {unmapped.length ? <MapItems names={unmapped} onDone={name => setUnmapped(u => u.filter(n => n !== name))} /> : null}

      <Card>
        <Title sub="Each menu item maps to the pours it uses. A 750 ml bottle is about 25.4 oz. Recipes match by drink name, so they keep working if you switch POS.">Recipes</Title>
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

function ProviderCard({ provider, onUnmapped }: { provider: PosProvider; onUnmapped: (names: string[]) => void }) {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const fields = provider.fields ?? [];
  const syncKey = `${provider.id}.lastSync`;
  const [creds, setCreds] = useState<PosCredentials | null>(null);
  const [form, setForm] = useState<Partial<Record<PosField['key'], string>>>({});
  const [sandbox, setSandbox] = useState(false);
  const [locations, setLocations] = useState<PosLocation[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    loadCredentials(provider.id).then(setCreds);
    getSetting(db, syncKey).then(setLastSync);
  }, [db, provider.id, syncKey]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try { await task(); } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const draft = (): PosCredentials => {
    const d: PosCredentials = { sandbox };
    for (const f of fields) {
      const v = form[f.key]?.trim();
      if (v) d[f.key] = v;
    }
    return d;
  };

  const connect = () => run(async () => {
    const d = draft();
    const locs = await provider.listLocations(d);
    if (!locs.length) throw new Error(`No active locations on this ${provider.name} account.`);
    if (locs.length === 1) return choose(d, locs[0]);
    setLocations(locs);
    setCreds(null);
  });

  async function choose(d: PosCredentials, loc: PosLocation) {
    const next = { ...d, locationId: loc.id };
    await saveCredentials(provider.id, next);
    setCreds(next);
    setLocations([]);
    setForm({});
    setStatus(`Connected to ${loc.name}.`);
  }

  const sync = () => run(async () => {
    if (!creds) return;
    const startedAt = new Date().toISOString();
    const since = lastSync ?? new Date(Date.now() - DAY_MS).toISOString();
    const sales = await provider.fetchSales(creds, since);
    const { applied, unmapped } = await applySales(db, provider.id, sales);
    await setSetting(db, syncKey, startedAt);
    setLastSync(startedAt);
    onUnmapped(unmapped);
    setStatus(`Pulled ${applied} new order${applied === 1 ? '' : 's'}.${unmapped.length ? ` ${unmapped.length} item${unmapped.length === 1 ? '' : 's'} need a recipe.` : ''}`);
    changed();
  });

  const disconnect = () => run(async () => {
    await clearCredentials(provider.id);
    setCreds(null);
  });

  const ready = fields.every(f => f.optional || form[f.key]?.trim());

  return (
    <Card>
      <Title sub={`Sales come in from ${provider.name} and the pours are taken out of stock.`}>{provider.name}</Title>
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
            <Button key={l.id} title={l.name} onPress={() => run(() => choose(draft(), l))} />
          ))}
        </>
      ) : (
        <>
          {provider.help ? <Text style={{ color: c.muted, fontSize: 13 }}>{provider.help}</Text> : null}
          {fields.map(f => (
            <View key={f.key} style={{ gap: 6 }}>
              <Label>{f.label}{f.optional ? ' (optional)' : ''}</Label>
              <Field
                value={form[f.key] ?? ''}
                onChangeText={v => setForm(s => ({ ...s, [f.key]: v }))}
                placeholder={f.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={f.secret}
              />
            </View>
          ))}
          {provider.sandbox ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: c.ink }}>Sandbox (test data)</Text>
              <Switch value={sandbox} onValueChange={setSandbox} />
            </View>
          ) : null}
          <Button kind="primary" title={busy ? 'Connecting…' : `Connect ${provider.name}`} disabled={busy || !ready} onPress={connect} />
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
    // Unmapped items are reported by display name. Saved for any POS, so the recipe survives a switch.
    await upsertRecipe(db, ANY_POS, `name:${current}`, current, [{ productId, oz: parseFloat(oz) || 1.5 }]);
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
