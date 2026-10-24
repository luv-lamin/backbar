import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { listProducts, saveCount } from '../db/repo';
import { variance } from '../domain/inventory';
import { Button, Card, Field, Title } from '../components/ui';
import { fmtBottles, fmtMoney, useColors } from '../theme';
import { useChanged, useQuery } from '../store';

export function CountScreen() {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const products = useQuery(listProducts, []);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);

  const rows = products.map(p => {
    const raw = counts[p.id];
    const counted = raw === undefined || raw === '' ? p.onHand : Math.max(0, parseFloat(raw) || 0);
    return { p, raw, ...variance(p, counted) };
  });
  const shortfall = rows.reduce((a, r) => a + Math.min(0, r.costCents), 0);
  const entered = rows.filter(r => r.raw !== undefined && r.raw !== '');

  async function save() {
    await saveCount(db, new Map(entered.map(r => [r.productId, r.counted])));
    setCounts({});
    setSaved(true);
    changed();
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 0 }}>
        <Title sub="Count what's on the shelf, in bottles (0.5 for half). Missing liquor usually means overpouring, unrung drinks, or theft.">
          End-of-shift count
        </Title>
        <View style={[styles.row, { borderColor: c.line }]}>
          <Text style={[styles.head, { color: c.muted, flex: 1 }]}>PRODUCT</Text>
          <Text style={[styles.head, styles.num, { color: c.muted }]}>EXPECTED</Text>
          <Text style={[styles.head, { color: c.muted, width: 72, textAlign: 'center' }]}>COUNTED</Text>
          <Text style={[styles.head, styles.num, { color: c.muted }]}>VARIANCE</Text>
        </View>
        {rows.map(r => (
          <View key={r.productId} style={[styles.row, { borderColor: c.line }]}>
            <Text style={{ color: c.ink, flex: 1 }} numberOfLines={2}>{r.p.name}</Text>
            <Text style={[styles.num, { color: c.muted }]}>{fmtBottles(r.expected)}</Text>
            <Field
              style={{ width: 72, textAlign: 'center', paddingVertical: 6 }}
              keyboardType="decimal-pad"
              placeholder={fmtBottles(r.expected)}
              value={r.raw ?? ''}
              onChangeText={t => { setSaved(false); setCounts(s => ({ ...s, [r.productId]: t })); }}
            />
            <Text style={[styles.num, { color: r.variance < 0 ? c.bad : r.variance > 0 ? c.ok : c.muted }]}>
              {r.variance > 0 ? '+' : ''}{fmtBottles(r.variance)}
              {r.costCents ? `\n${fmtMoney(r.costCents)}` : ''}
            </Text>
          </View>
        ))}
      </Card>
      <Text style={{ color: shortfall < 0 ? c.bad : c.muted, fontWeight: '600' }}>
        {saved ? 'Count saved. Stock now matches the shelf.' : shortfall < 0 ? `Shift shortfall: ${fmtMoney(-shortfall)} at cost` : 'No shortfall so far.'}
      </Text>
      <Button kind="primary" title={`Save count (${entered.length})`} disabled={!entered.length} onPress={save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  head: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  num: { width: 70, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
