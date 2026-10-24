import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SQLiteProvider } from 'expo-sqlite';
import { migrate } from './src/db/schema';
import { DataProvider } from './src/store';
import { useColors } from './src/theme';
import { ScanScreen } from './src/screens/ScanScreen';
import { StockScreen } from './src/screens/StockScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { PosScreen } from './src/screens/PosScreen';

const TABS = [
  { key: 'scan', label: 'Scan', Screen: ScanScreen },
  { key: 'stock', label: 'Stock', Screen: StockScreen },
  { key: 'inventory', label: 'Inventory', Screen: InventoryScreen },
  { key: 'pos', label: 'POS', Screen: PosScreen },
] as const;

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName="backbar.db" onInit={migrate}>
        <DataProvider>
          <Shell />
        </DataProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const c = useColors();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('scan');
  const { Screen } = TABS.find(t => t.key === tab)!;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }} edges={['top', 'bottom']}>
      <StatusBar style="auto" />
      <View style={[styles.header, { borderColor: c.line }]}>
        <Text style={[styles.brand, { color: c.ink }]}>Back<Text style={{ color: c.accent }}>bar</Text></Text>
      </View>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Screen />
      </View>
      <View style={[styles.tabs, { borderColor: c.line }]}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            onPress={() => setTab(t.key)}
            style={styles.tab}
          >
            <View style={[styles.tabMark, { backgroundColor: tab === t.key ? c.accent : 'transparent' }]} />
            <Text style={{ color: tab === t.key ? c.ink : c.muted, fontWeight: '600' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  brand: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', paddingBottom: 10, gap: 8 },
  tabMark: { height: 3, width: '60%', borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
});
