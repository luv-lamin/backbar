import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { listProducts } from '../db/repo';
import { loadSampleBar } from '../db/sample';
import { bottlesToReorder, stockStatus } from '../domain/inventory';
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
    </ScrollView>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface, borderColor: c.line }]}>
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
