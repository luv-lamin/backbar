import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSQLiteContext } from 'expo-sqlite';
import { addProduct, findByUpc, recentActivity, recordMovement } from '../db/repo';
import { movementDelta, normalizeBarcode, type Product } from '../domain/inventory';
import { Button, Card, Field, Label, Segmented, Title } from '../components/ui';
import { fmtBottles, useColors } from '../theme';
import { useChanged, useQuery } from '../store';

type Mode = 'in' | 'out' | 'waste';
const WASTE_AMOUNTS: [number, string][] = [[1, 'Full'], [0.75, '¾'], [0.5, '½'], [0.25, '¼'], [0.06, 'Shot']];

export function ScanScreen() {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('in');
  const [code, setCode] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [amount, setAmount] = useState(1);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const busy = useRef(false);
  const activity = useQuery(d => recentActivity(d, 15), []);

  async function lookup(raw: string) {
    const upc = normalizeBarcode(raw);
    if (!upc) return;
    setCode(upc);
    setMessage(null);
    setQty('1');
    setAmount(1);
    const p = await findByUpc(db, upc);
    setProduct(p);
    setUnknownCode(p ? null : upc);
  }

  function onScanned(r: BarcodeScanningResult) {
    // The camera fires many times per second; take one read until the scan is handled.
    if (busy.current || product || unknownCode) return;
    busy.current = true;
    lookup(r.data).finally(() => { busy.current = false; });
  }

  function reset() {
    setProduct(null);
    setUnknownCode(null);
    setCode('');
  }

  async function commit() {
    if (!product) return;
    const n = parseInt(qty, 10);
    if (!n || n < 1) return setMessage({ text: 'Enter at least 1 bottle.', ok: false });
    const bottles = mode === 'waste' ? n * amount : n;
    if (mode !== 'in' && bottles > product.onHand) {
      return setMessage({ text: `Only ${fmtBottles(product.onHand)} bottles of ${product.name} on hand.`, ok: false });
    }
    const onHand = await recordMovement(db, product.id, mode, movementDelta(mode, bottles));
    const verb = { in: 'Received', out: 'Sent to bar', waste: 'Logged waste:' }[mode];
    setMessage({ text: `${verb} ${fmtBottles(bottles)} × ${product.name}. Now ${fmtBottles(onHand)} on hand.`, ok: true });
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
            <Button style={{ flex: 1 }} kind="primary" title={{ in: 'Receive', out: 'Send to bar', waste: 'Log waste' }[mode]} onPress={commit} />
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
  reticle: { position: 'absolute', width: '70%', height: 90, borderWidth: 2, borderRadius: 8 },
  toast: { padding: 12, borderRadius: 10, fontWeight: '500', overflow: 'hidden' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
