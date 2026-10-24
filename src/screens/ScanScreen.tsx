import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSQLiteContext } from 'expo-sqlite';
import { addProduct, findByUpc, recentActivity, recordMovement } from '../db/repo';
import { movementDelta, normalizeBarcode, type Product } from '../domain/inventory';
import { Button, Card, Field, Label, Segmented, Title } from '../components/ui';
import { fmtBottles, useColors } from '../theme';
import { useChanged, useQuery } from '../store';

type Mode = 'in' | 'out' | 'waste';
const WASTE_AMOUNTS: [number, string][] = [[1, 'Full'], [0.75, '¾'], [0.5, '½'], [0.25, '¼'], [0.06, 'Shot']];
// Common case and half-case sizes, so a delivery is one tap and one scan.
const BATCH_PRESETS = [1, 6, 12, 24];

export function ScanScreen() {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('in');
  const [code, setCode] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [batch, setBatch] = useState('1');
  const [autoLog, setAutoLog] = useState(false);
  const [qty, setQty] = useState('1');
  const [amount, setAmount] = useState(1);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const busy = useRef(false);
  const lastScan = useRef({ code: '', at: 0 });
  const activity = useQuery(d => recentActivity(d, 15), []);

  async function lookup(raw: string) {
    const upc = normalizeBarcode(raw);
    if (!upc) return;
    setCode(upc);
    setMessage(null);
    setQty(batch);
    setAmount(1);
    const p = await findByUpc(db, upc);
    // Waste needs the amount-lost choice, so it always stops for confirmation.
    if (p && autoLog && mode !== 'waste') return commit(p, batch);
    setProduct(p);
    setUnknownCode(p ? null : upc);
  }

  function onScanned(r: BarcodeScanningResult) {
    // The camera fires many times per second; take one read until the scan is handled.
    if (busy.current || product || unknownCode) return;
    // With auto-log on, the same bottle stays in view after it's logged; don't count it twice.
    const now = Date.now();
    if (r.data === lastScan.current.code && now - lastScan.current.at < 2500) return;
    lastScan.current = { code: r.data, at: now };
    busy.current = true;
    lookup(r.data).finally(() => { busy.current = false; });
  }

  function reset() {
    setProduct(null);
    setUnknownCode(null);
    setCode('');
  }

  async function commit(p: Product | null = product, count = qty) {
    if (!p) return;
    const n = parseInt(count, 10);
    if (!n || n < 1) return setMessage({ text: 'Enter at least 1 bottle.', ok: false });
    const bottles = mode === 'waste' ? n * amount : n;
    if (mode !== 'in' && bottles > p.onHand) {
      return setMessage({ text: `Only ${fmtBottles(p.onHand)} bottles of ${p.name} on hand.`, ok: false });
    }
    const onHand = await recordMovement(db, p.id, mode, movementDelta(mode, bottles));
    const verb = { in: 'Received', out: 'Sent to bar', waste: 'Logged waste:' }[mode];
    setMessage({ text: `${verb} ${fmtBottles(bottles)} × ${p.name}. Now ${fmtBottles(onHand)} on hand.`, ok: true });
    reset();
    changed();
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'in', label: 'In', hint: 'Delivery', tint: [c.okSoft, c.ok] },
          { value: 'out', label: 'Out', hint: 'To the bar', tint: [c.brassSoft, c.brass] },
          { value: 'waste', label: 'Waste', hint: 'Spill, comp', tint: [c.badSoft, c.bad] },
        ]}
      />

      <Card>
        <Label>Bottles per scan</Label>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Button title="−" onPress={() => setBatch(b => String(Math.max(1, (parseInt(b, 10) || 1) - 1)))} style={styles.step} />
          <Field
            style={{ width: 64, textAlign: 'center', fontSize: 18, fontWeight: '700' }}
            value={batch}
            onChangeText={t => setBatch(t.replace(/\D/g, ''))}
            onEndEditing={() => setBatch(b => String(Math.max(1, parseInt(b, 10) || 1)))}
            keyboardType="number-pad"
            accessibilityLabel="Bottles per scan"
          />
          <Button title="+" onPress={() => setBatch(b => String((parseInt(b, 10) || 0) + 1))} style={styles.step} />
          <View style={{ flex: 1 }} />
          {BATCH_PRESETS.slice(1).map(n => (
            <Button key={n} title={String(n)} kind={batch === String(n) ? 'primary' : 'plain'} onPress={() => setBatch(String(n))} style={styles.step} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: c.ink, flex: 1 }}>
            Log right away on scan{'\n'}
            <Text style={{ color: c.muted, fontSize: 12 }}>Skips the confirm step for In and Out. Waste always asks.</Text>
          </Text>
          <Switch value={autoLog} onValueChange={setAutoLog} accessibilityLabel="Log right away on scan" />
        </View>
      </Card>

      <View style={[styles.camera, { backgroundColor: c.ink }]}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['upc_a', 'upc_e', 'ean13', 'ean8'] }}
            onBarcodeScanned={product || unknownCode ? undefined : onScanned}
          />
        ) : (
          <View style={styles.cameraOff}>
            <Text style={{ color: c.surface, textAlign: 'center' }}>
              {permission?.canAskAgain === false
                ? 'Camera access is off. Turn it on in Settings, or type the barcode below.'
                : 'Allow the camera to scan bottle barcodes.'}
            </Text>
            {permission?.canAskAgain !== false ? <Button title="Allow camera" kind="primary" onPress={requestPermission} /> : null}
          </View>
        )}
        <View pointerEvents="none" style={[styles.reticle, { borderColor: c.brass }]} />
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Field
          style={{ flex: 1, fontVariant: ['tabular-nums'] }}
          value={code}
          onChangeText={setCode}
          placeholder="Or type / use a Bluetooth scanner"
          keyboardType="number-pad"
          returnKeyType="search"
          onSubmitEditing={() => lookup(code)}
        />
        <Button title="Look up" onPress={() => lookup(code)} />
      </View>

      {message ? (
        <Text style={[styles.toast, { backgroundColor: message.ok ? c.okSoft : c.badSoft, color: message.ok ? c.ok : c.bad }]}>
          {message.text}
        </Text>
      ) : null}

      {product ? (
        <Card>
          <View>
            <Text style={{ color: c.ink, fontSize: 17, fontWeight: '700' }}>{product.name}</Text>
            <Text style={{ color: c.muted }}>{product.upc} · {product.sizeMl} ml · {fmtBottles(product.onHand)} on hand</Text>
          </View>
          {mode === 'waste' ? (
            <View style={{ gap: 6 }}>
              <Label>Amount lost per bottle</Label>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {WASTE_AMOUNTS.map(([v, l]) => (
                  <Button key={l} title={l} kind={amount === v ? 'primary' : 'plain'} onPress={() => setAmount(v)} style={{ flex: 1, paddingHorizontal: 0 }} />
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ width: 90, gap: 6 }}>
              <Label>Bottles</Label>
              <Field value={qty} onChangeText={setQty} keyboardType="number-pad" />
            </View>
            <Button style={{ flex: 1 }} kind="primary" title={{ in: 'Receive', out: 'Send to bar', waste: 'Log waste' }[mode]} onPress={() => commit()} />
          </View>
          <Button title="Cancel" onPress={reset} />
        </Card>
      ) : null}

      {unknownCode ? <NewProductForm upc={unknownCode} onDone={p => { setUnknownCode(null); setProduct(p); changed(); }} onCancel={reset} /> : null}

      <Card>
        <Title>Recent activity</Title>
        {activity.length === 0 ? <Text style={{ color: c.muted }}>Nothing yet. Scan a bottle to start.</Text> : null}
        {activity.map(a => (
          <View key={a.id} style={[styles.logRow, { borderColor: c.line }]}>
            <Text style={{ color: c.muted, width: 52, fontSize: 12 }}>{a.createdAt.slice(11, 16)}</Text>
            <Text style={{ color: c.ink, flex: 1 }} numberOfLines={1}>
              <Text style={{ fontWeight: '700', fontSize: 11 }}>{a.kind.toUpperCase()}  </Text>{a.productName}
            </Text>
            <Text style={{ color: c.muted, fontVariant: ['tabular-nums'] }}>{a.bottles > 0 ? '+' : ''}{fmtBottles(a.bottles)}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function NewProductForm({ upc, onDone, onCancel }: { upc: string; onDone: (p: Product) => void; onCancel: () => void }) {
  const db = useSQLiteContext();
  const c = useColors();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [size, setSize] = useState('750');
  const [cost, setCost] = useState('');
  const [par, setPar] = useState('');
  const [error, setError] = useState('');

  async function save() {
    if (!name.trim()) return setError('Give the product a name.');
    const p = await addProduct(db, {
      upc,
      name: name.trim(),
      category: category.trim() || 'Other',
      sizeMl: parseInt(size, 10) || 750,
      costCents: Math.round((parseFloat(cost) || 0) * 100),
      par: parseFloat(par) || 0,
    });
    onDone(p);
  }

  return (
    <Card>
      <Title sub={`Barcode ${upc} isn't in your catalog yet.`}>Add new product</Title>
      <View style={{ gap: 6 }}><Label>Name</Label><Field value={name} onChangeText={setName} placeholder="e.g. Maker's Mark Bourbon" /></View>
      <View style={{ gap: 6 }}><Label>Category</Label><Field value={category} onChangeText={setCategory} placeholder="Whiskey" /></View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, gap: 6 }}><Label>Size (ml)</Label><Field value={size} onChangeText={setSize} keyboardType="number-pad" /></View>
        <View style={{ flex: 1, gap: 6 }}><Label>Cost ($)</Label><Field value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="24.00" /></View>
        <View style={{ flex: 1, gap: 6 }}><Label>Par</Label><Field value={par} onChangeText={setPar} keyboardType="decimal-pad" placeholder="4" /></View>
      </View>
      {error ? <Text style={{ color: c.bad }}>{error}</Text> : null}
      <Button kind="primary" title="Add product" onPress={save} />
      <Button title="Cancel" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14 },
  camera: { height: 220, borderRadius: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  cameraOff: { padding: 20, gap: 12, alignItems: 'center' },
  step: { minWidth: 44, paddingHorizontal: 10 },
  reticle: { position: 'absolute', width: '70%', height: 90, borderWidth: 2, borderRadius: 8 },
  toast: { padding: 12, borderRadius: 10, fontWeight: '500', overflow: 'hidden' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
