import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { useColors } from '../theme';
import { Glass } from './Glass';
import type { StockStatus } from '../domain/inventory';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <Glass style={[styles.card, style]}>{children}</Glass>;
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[styles.title, { color: c.ink }]}>{children}</Text>
      {sub ? <Text style={{ color: c.muted, fontSize: 14 }}>{sub}</Text> : null}
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[styles.label, { color: c.muted }]}>{children}</Text>;
}

export function Button({
  title, onPress, kind = 'plain', disabled, style,
}: { title: string; onPress: () => void; kind?: 'plain' | 'primary' | 'danger'; disabled?: boolean; style?: ViewStyle }) {
  const c = useColors();
  const bg = kind === 'primary' ? c.accent : kind === 'danger' ? c.badSoft : c.glass;
  const fg = kind === 'primary' ? c.surface : kind === 'danger' ? c.bad : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'primary' ? c.accent : c.glassBorder, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const c = useColors();
  return (
    <TextInput
      placeholderTextColor={c.muted}
      {...props}
      style={[styles.input, { backgroundColor: c.glass, borderColor: c.glassBorder, color: c.ink }, props.style]}
    />
  );
}

const STATUS_LABEL: Record<StockStatus, string> = { ok: 'At par', low: 'Below par', out: 'Out' };

export function StatusPill({ status }: { status: StockStatus }) {
  const c = useColors();
  const [bg, fg] = status === 'ok' ? [c.okSoft, c.ok] : status === 'low' ? [c.warnSoft, c.warn] : [c.badSoft, c.bad];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string; hint?: string; tint: [string, string] }[]; value: T; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[styles.seg, { borderColor: c.glassBorder }]}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, { backgroundColor: on ? o.tint[0] : c.glass, borderLeftWidth: i ? 1 : 0, borderColor: c.glassBorder }]}
          >
            <Text style={{ color: on ? o.tint[1] : c.muted, fontWeight: '700', fontSize: 15 }}>{o.label}</Text>
            {o.hint ? <Text style={{ color: on ? o.tint[1] : c.muted, fontSize: 11 }}>{o.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  // Capsule buttons, as in Apple's Liquid Glass.
  button: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 99, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, fontSize: 16 },
  pill: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  seg: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, overflow: 'hidden' },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
});
