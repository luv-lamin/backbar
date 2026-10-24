import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { listProducts, wasteSince } from '../db/repo';
import { loadSampleBar } from '../db/sample';
import { bottlesToReorder, stockStatus, WASTE_REASONS, wasteByStaff } from '../domain/inventory';
import { Button, Card, StatusPill, Title } from '../components/ui';
import { fmtBottles, fmtMoney, useColors } from '../theme';
import { useChanged, useQuery } from '../store';

export function StockScreen() {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const products = useQuery(listProducts, []);

  const low = products.filter(p => stockStatus(p) !== 'ok');
  const valueCents = products.reduce((a, p) => a + p.onHand * p.costCents, 0);
  const reorder = products.reduce((a, p) => a + bottlesToReorder(p), 0);

  if (products.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Card>
          <Title sub="Scan a bottle on the Scan tab to add your first product, or load a sample back bar to look around.">No products yet</Title>
          <Button kind="primary" title="Load sample back bar" onPress={() => loadSampleBar(db).then(changed)} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.stats}>
        <Stat value={fmtMoney(valueCents).replace(/\.\d+$/, '')} label="Stock value at cost" />
        <Stat value={String(low.length)} label="Below par or out" tone={low.length ? c.warn : undefined} />
        <Stat value={String(reorder)} label="Bottles to reorder" />
      </View>
      <Card style={{ gap: 0 }}>
        <Title sub="Bottles on hand against par, the level you want before the next order.">Stock on hand</Title>
        {products.map(p => {
          const s = stockStatus(p);
          const pct = p.par > 0 ? Math.min(1, p.onHand / p.par) : 1;
          const bar = s === 'ok' ? c.ok : s === 'low' ? c.warn : c.bad;
          return (
            <View key={p.id} style={[styles.row, { borderColor: c.line }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: c.ink, fontWeight: '600' }} numberOfLines={1}>{p.name}</Text>
                <View style={[styles.meter, { backgroundColor: c.line }]}>
                  <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: bar }} />
                </View>
                <Text style={{ color: c.muted, fontSize: 12 }}>{p.category}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ color: c.ink, fontVariant: ['tabular-nums'], fontWeight: '600' }}>
                  {fmtBottles(p.onHand)} <Text style={{ color: c.muted, fontWeight: '400' }}>/ {fmtBottles(p.par)}</Text>
                </Text>
                <StatusPill status={s} />
              </View>
            </View>
          );
        })}
      </Card>
      <WasteCard />
    </ScrollView>
  );
}

const PERIODS = [
  { label: 'This shift', hours: 12 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

function WasteCard() {
  const c = useColors();
  const [hours, setHours] = useState(PERIODS[0].hours);
  const data = useQuery(d => wasteSince(d, hours), { entries: [], names: new Map<number, string>() }, [hours]);
  const rows = wasteByStaff(data.entries);
  const total = rows.reduce((a, r) => a + r.costCents, 0);

  return (
    <Card style={{ gap: 10 }}>
      <Title sub="Spills, comps and breakage at cost, by who logged them. Pick your name at the top of the app before scanning.">
        Waste by bartender
      </Title>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {PERIODS.map(p => (
          <Button key={p.hours} title={p.label} kind={hours === p.hours ? 'primary' : 'plain'} onPress={() => setHours(p.hours)} style={{ flex: 1, paddingHorizontal: 0, paddingVertical: 8 }} />
        ))}
      </View>
      {!rows.length ? <Text style={{ color: c.muted }}>No waste logged in this period.</Text> : null}
      {rows.map(r => (
        <View key={r.staffId ?? 'none'} style={[styles.row, { borderColor: c.line }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{r.staffId === null ? 'No name picked' : data.names.get(r.staffId) ?? 'Removed'}</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>
              {WASTE_REASONS.filter(w => r.byReason[w.value]).map(w => `${w.label} ${fmtMoney(r.byReason[w.value]!)}`).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: c.bad, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{fmtMoney(r.costCents)}</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>{fmtBottles(r.bottles)} btl</Text>
          </View>
        </View>
      ))}
      {rows.length > 1 ? <Text style={{ color: c.muted, textAlign: 'right' }}>Total {fmtMoney(total)}</Text> : null}
    </Card>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.glass, borderColor: c.glassBorder }]}>
      <Text style={{ color: tone ?? c.ink, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  meter: { height: 6, borderRadius: 99, overflow: 'hidden' },
});
