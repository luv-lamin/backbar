import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SQLiteProvider } from 'expo-sqlite';
import { LinearGradient } from 'expo-linear-gradient';
import { migrate } from './src/db/schema';
import { DataProvider } from './src/store';
import { useColors } from './src/theme';
import { ScanScreen } from './src/screens/ScanScreen';
import { StockScreen } from './src/screens/StockScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { PosScreen } from './src/screens/PosScreen';
import { StaffPicker } from './src/components/StaffPicker';
import { Glass } from './src/components/Glass';

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
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    {/* Glass needs something behind it to refract, so the app sits on a soft gradient. */}
    <LinearGradient colors={[c.gradientTop, c.gradientBottom]} style={StyleSheet.absoluteFill} />
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <StatusBar style="auto" />
      <Glass style={styles.header} radius={24}>
        <Text style={[styles.brand, { color: c.ink }]}>Back<Text style={{ color: c.accent }}>bar</Text></Text>
        <StaffPicker />
      </Glass>
      <View style={{ flex: 1 }}>
        <Screen />
      </View>
      <Glass style={styles.tabs} radius={28} interactive>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            onPress={() => setTab(t.key)}
            style={styles.tab}
          >
            <View style={[styles.tabPill, tab === t.key && { backgroundColor: c.accentSoft }]}>
              <Text style={{ color: tab === t.key ? c.ink : c.muted, fontWeight: tab === t.key ? '700' : '600' }}>{t.label}</Text>
            </View>
          </Pressable>
        ))}
      </Glass>
    </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Header and tab bar float as glass capsules over the content, as in iOS 26.
  header: {
    marginHorizontal: 12, marginTop: 4, paddingHorizontal: 16, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  brand: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  tabs: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 4, padding: 6 },
  tab: { flex: 1 },
  tabPill: { alignItems: 'center', paddingVertical: 10, borderRadius: 22 },
});
