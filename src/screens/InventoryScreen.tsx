import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import {
  addToCount,
  cancelInventory,
  findByUpc,
  finishedInventories,
  finishInventory,
  inventoryCounts,
  listProducts,
  openInventory,
  setCount,
  startInventory,
  type InventorySession,
} from '../db/repo';
import { normalizeBarcode, type Product, type StockTakeReport } from '../domain/inventory';
import { BarcodeCamera } from '../components/BarcodeCamera';
import { Button, Card, Field, Label, Title } from '../components/ui';
import { fmtBottles, fmtMoney, useColors } from '../theme';
import { useChanged, useQuery } from '../store';

const LEVELS: [number, string][] = [[1, 'Full'], [0.75, '¾'], [0.5, '½'], [0.25, '¼']];
// Tenths, the way bar inventory is usually counted by eye against the bottle's shape.
const TENTHS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
const MULTIPLIERS = [1, 6, 12];

export function InventoryScreen() {
  const session = useQuery(openInventory, null);
  const history = useQuery(d => finishedInventories(d), []);
  const products = useQuery(listProducts, []);
  return session
    ? <CountingView session={session} products={products} />
    : <StartView history={history} products={products} />;
}

function StartView({ history, products }: { history: InventorySession[]; products: Product[] }) {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  // Undefined until someone taps: the newest report starts expanded.
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const open = picked === undefined ? history[0]?.id ?? null : picked;
  const setOpen = setPicked;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Title sub="Scan every bottle on the shelves and in storage. When you finish, stock is set to what you counted, and you get a report comparing it with what your sales and scans say should be there.">
          Inventory
        </Title>
        <Button kind="primary" title="Start inventory" disabled={!products.length} onPress={() => startInventory(db).then(changed)} />
        {!products.length ? <Text style={{ color: c.muted }}>Add products first, on the Scan or Stock tab.</Text> : null}
      </Card>
      {history.map(s => (
        <Card key={s.id}>
          <ReportSummary session={s} onToggle={() => setOpen(open === s.id ? null : s.id)} expanded={open === s.id} />
          {open === s.id && s.report ? <ReportRows report={s.report} products={products} /> : null}
        </Card>
      ))}
    </ScrollView>
  );
}

function CountingView({ session, products }: { session: InventorySession; products: Product[] }) {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const counts = useQuery(d => inventoryCounts(d, session.id), new Map<number, number>());
  const [level, setLevel] = useState(1);
  const [multiplier, setMultiplier] = useState(1);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [lastAdd, setLastAdd] = useState<{ productId: number; bottles: number } | null>(null);
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [uncountedAsZero, setUncountedAsZero] = useState(false);
  const [edits, setEdits] = useState<Record<number, string>>({});

  async function scan(raw: string) {
    const upc = normalizeBarcode(raw);
    if (!upc) return;
    const p = await findByUpc(db, upc);
    if (!p) {
      setMessage({ text: `Barcode ${upc} isn't in your catalog. Add it on the Scan tab, then scan it here.`, ok: false });
      return;
    }
    // A case multiplier only makes sense for sealed bottles.
    const bottles = level === 1 ? multiplier : level;
    const total = await addToCount(db, session.id, p.id, bottles);
    setLastAdd({ productId: p.id, bottles });
    setMessage({ text: `+${fmtBottles(bottles)} ${p.name}. Counted ${fmtBottles(total)}.`, ok: true });
    setCode('');
    // An open bottle is a one-off; go back to full bottles for the next scan.
    if (level !== 1) setLevel(1);
    changed();
  }

  async function undo() {
    if (!lastAdd) return;
    await addToCount(db, session.id, lastAdd.productId, -lastAdd.bottles);
    setLastAdd(null);
    setMessage({ text: 'Last scan undone.', ok: true });
    changed();
  }

  async function bump(p: Product, delta: number) {
    await addToCount(db, session.id, p.id, delta);
    changed();
  }

  async function saveEdit(p: Product) {
    const raw = edits[p.id];
    setEdits(e => { const { [p.id]: _, ...rest } = e; return rest; });
    if (raw === undefined) return;
    await setCount(db, session.id, p.id, raw.trim() === '' ? null : Math.max(0, parseFloat(raw) || 0));
    changed();
  }

  async function finish() {
    await finishInventory(db, session.id, uncountedAsZero);
    changed();
  }

  function confirmFinish() {
    const missing = products.length - counts.size;
    Alert.alert(
      'Finish inventory?',
      `Stock will be set to what you counted.${missing ? ` ${missing} product${missing === 1 ? '' : 's'} not counted will ${uncountedAsZero ? 'be set to 0' : 'keep their current stock'}.` : ''}`,
      [{ text: 'Keep counting', style: 'cancel' }, { text: 'Finish', onPress: finish }],
    );
  }

  function confirmCancel() {
    Alert.alert('Discard this inventory?', 'Counts so far will be deleted. Stock is not changed.', [
      { text: 'Keep counting', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => cancelInventory(db, session.id).then(changed) },
    ]);
  }

  const shown = onlyUncounted ? products.filter(p => !counts.has(p.id)) : products;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card>
        <Title sub={`Started ${session.startedAt.slice(0, 16).replace('T', ' ')} · ${counts.size} of ${products.length} products counted`}>
          Inventory in progress
        </Title>
        <View style={[styles.progress, { backgroundColor: c.line }]}>
          <View style={{ width: `${products.length ? (counts.size / products.length) * 100 : 0}%`, height: '100%', backgroundColor: c.accent }} />
        </View>
        <Label>Each scan counts</Label>
        <View style={styles.chips}>
          {LEVELS.map(([v, l]) => (
            <Button key={l} title={l} kind={level === v ? 'primary' : 'plain'} onPress={() => setLevel(v)} style={styles.chip} />
          ))}
          <View style={{ width: 8 }} />
          {MULTIPLIERS.map(m => (
            <Button key={m} title={`×${m}`} kind={multiplier === m ? 'primary' : 'plain'} onPress={() => setMultiplier(m)} style={styles.chip} />
          ))}
        </View>
        <Label>Open bottle, by tenths</Label>
        <View style={styles.chips}>
          {TENTHS.map(t => (
            <Button key={t} title={`.${Math.round(t * 10)}`} kind={level === t ? 'primary' : 'plain'} onPress={() => setLevel(t)} style={styles.tenth} />
          ))}
        </View>
        <Text style={{ color: c.muted, fontSize: 12 }}>
          For an open bottle, pick how full it is, then scan it. It goes back to Full after one scan. Use ×6 or ×12 for sealed cases.
        </Text>
      </Card>

      <BarcodeCamera onScan={scan} />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field
          style={{ flex: 1 }}
          value={code}
          onChangeText={setCode}
          placeholder="Or type / use a Bluetooth scanner"
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={() => scan(code)}
        />
        <Button title="Add" onPress={() => scan(code)} />
      </View>

      {message ? (
        <View style={[styles.toast, { backgroundColor: message.ok ? c.okSoft : c.badSoft }]}>
          <Text style={{ color: message.ok ? c.ok : c.bad, fontWeight: '500', flex: 1 }}>{message.text}</Text>
          {lastAdd ? <Button title="Undo" onPress={undo} style={{ paddingVertical: 6 }} /> : null}
        </View>
      ) : null}

      <Card style={{ gap: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8 }}>
          <Title>Counts</Title>
          <Button
            title={onlyUncounted ? 'Show all' : `Not counted (${products.length - counts.size})`}
            onPress={() => setOnlyUncounted(v => !v)}
            style={{ paddingVertical: 6 }}
          />
        </View>
        {shown.map(p => {
          const n = counts.get(p.id);
          return (
            <View key={p.id} style={[styles.row, { borderColor: c.line }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontWeight: '600' }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>System says {fmtBottles(p.onHand)}</Text>
              </View>
              <Button title="−" onPress={() => bump(p, -1)} style={styles.step} disabled={!n} />
              <Field
                style={{ width: 64, textAlign: 'center', paddingVertical: 6 }}
                keyboardType="decimal-pad"
                placeholder="—"
                value={edits[p.id] ?? (n === undefined ? '' : fmtBottles(n))}
                onChangeText={t => setEdits(e => ({ ...e, [p.id]: t }))}
                onEndEditing={() => saveEdit(p)}
                accessibilityLabel={`Count for ${p.name}`}
              />
              <Button title="+" onPress={() => bump(p, 1)} style={styles.step} />
            </View>
          );
        })}
        {!shown.length ? <Text style={{ color: c.muted, paddingTop: 8 }}>Everything has been counted.</Text> : null}
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ color: c.ink, flex: 1 }}>
            Count products I didn't scan as 0{'\n'}
            <Text style={{ color: c.muted, fontSize: 12 }}>Turn on for a full monthly count. Off keeps their current stock.</Text>
          </Text>
          <Switch value={uncountedAsZero} onValueChange={setUncountedAsZero} accessibilityLabel="Count products I didn't scan as 0" />
        </View>
        <Button kind="primary" title="Finish inventory" disabled={!counts.size} onPress={confirmFinish} />
        <Button kind="danger" title="Discard inventory" onPress={confirmCancel} />
      </Card>
    </ScrollView>
  );
}

function ReportSummary({ session, expanded, onToggle }: { session: InventorySession; expanded: boolean; onToggle: () => void }) {
  const c = useColors();
  const r = session.report;
  if (!r) return null;
  const accuracy = r.salesAccuracy === null ? null : Math.round(r.salesAccuracy * 100);
  // Reports saved before the no-POS setting existed were all POS reports.
  const usesPos = r.usesPos !== false;
  return (
    <View style={{ gap: 10 }}>
      <Title sub={`${r.counted} counted${r.uncounted ? `, ${r.uncounted} not counted` : ''}`}>
        Inventory {session.finishedAt?.slice(0, 10)}
      </Title>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Stat label="Missing at cost" value={fmtMoney(r.shortfallCents)} tone={r.shortfallCents ? c.bad : c.ok} />
        <Stat
          label={usesPos ? 'Sales accuracy' : 'Scan accuracy'}
          value={accuracy === null ? '—' : `${accuracy}%`}
          tone={accuracy === null ? c.muted : accuracy >= 95 ? c.ok : accuracy >= 85 ? c.warn : c.bad}
        />
      </View>
      <Text style={{ color: c.muted, fontSize: 12 }}>
        {accuracy === null
          ? `${usesPos ? 'Sales' : 'Scan'} accuracy appears from your second inventory, once there is a starting count to compare against.`
          : `Your ${usesPos ? 'POS sales' : 'Out scans'} and waste log explain ${accuracy}% of the liquor that left the shelves since the last inventory.`}
      </Text>
      <Button title={expanded ? 'Hide details' : 'Show details'} onPress={onToggle} />
    </View>
  );
}

function ReportRows({ report, products }: { report: StockTakeReport; products: Product[] }) {
  const c = useColors();
  const recordedLabel = report.usesPos === false ? 'sent out + waste' : 'sold + waste';
  const name = (id: number) => products.find(p => p.id === id)?.name ?? 'Deleted product';
  const rows = [...report.rows].sort((a, b) => (a.varianceCents ?? 0) - (b.varianceCents ?? 0));
  return (
    <View>
      {rows.map(r => (
        <View key={r.productId} style={[styles.reportRow, { borderColor: c.line }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: c.ink, fontWeight: '600', flex: 1 }} numberOfLines={1}>{name(r.productId)}</Text>
            <Text style={[styles.num, { color: r.variance === null ? c.muted : r.variance < 0 ? c.bad : r.variance > 0 ? c.ok : c.muted }]}>
              {r.variance === null ? 'Not counted' : `${r.variance > 0 ? '+' : ''}${fmtBottles(r.variance)} · ${fmtMoney(r.varianceCents ?? 0)}`}
            </Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            Expected {fmtBottles(r.expected)} · counted {r.counted === null ? '—' : fmtBottles(r.counted)}
            {r.actualUsage !== null ? ` · used ${fmtBottles(r.actualUsage)}, ${recordedLabel} ${fmtBottles(r.recordedUsage)}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { borderColor: c.glassBorder, backgroundColor: c.glass }]}>
      <Text style={{ color: tone, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  progress: { height: 6, borderRadius: 99, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minWidth: 48, paddingHorizontal: 10, paddingVertical: 8 },
  tenth: { minWidth: 34, paddingHorizontal: 6, paddingVertical: 8 },
  step: { minWidth: 40, paddingHorizontal: 8, paddingVertical: 6 },
  toast: { padding: 10, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  reportRow: { paddingVertical: 10, gap: 2, borderTopWidth: StyleSheet.hairlineWidth },
  num: { fontVariant: ['tabular-nums'] },
  stat: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, gap: 2 },
});
