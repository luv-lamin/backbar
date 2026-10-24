import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Button } from './ui';
import { useColors } from '../theme';

/**
 * Camera preview that reports bottle barcodes. It takes one read at a time and ignores
 * the same code for a moment, since a bottle stays in view after it's been scanned.
 */
export function BarcodeCamera({ onScan, paused = false }: { onScan: (code: string) => Promise<unknown> | void; paused?: boolean }) {
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const busy = useRef(false);
  const lastScan = useRef({ code: '', at: 0 });

  function onScanned(r: BarcodeScanningResult) {
    if (busy.current) return;
    const now = Date.now();
    if (r.data === lastScan.current.code && now - lastScan.current.at < 2500) return;
    lastScan.current = { code: r.data, at: now };
    busy.current = true;
    Promise.resolve(onScan(r.data)).finally(() => { busy.current = false; });
  }

  return (
    <View style={[styles.camera, { backgroundColor: c.ink }]}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['upc_a', 'upc_e', 'ean13', 'ean8'] }}
          onBarcodeScanned={paused ? undefined : onScanned}
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
      <View pointerEvents="none" style={[styles.reticle, { borderColor: c.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { height: 220, borderRadius: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  cameraOff: { padding: 20, gap: 12, alignItems: 'center' },
  reticle: { position: 'absolute', width: '70%', height: 90, borderWidth: 2, borderRadius: 8 },
});
