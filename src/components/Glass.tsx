import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { useColorScheme } from 'react-native';
import { useColors } from '../theme';

// iOS 26+ gets Apple's real Liquid Glass. Older iOS gets a system blur, and Android a
// translucent frosted panel, so the layout looks the same everywhere.
const LIQUID = Platform.OS === 'ios' && isLiquidGlassAvailable();

export function Glass({
  children, style, radius = 18, interactive = false,
}: { children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; interactive?: boolean }) {
  const c = useColors();
  const dark = useColorScheme() === 'dark';
  const shape = { borderRadius: radius, borderCurve: 'continuous' as const };

  if (LIQUID) {
    return <GlassView glassEffectStyle="regular" isInteractive={interactive} style={[shape, style]}>{children}</GlassView>;
  }
  const frame = [shape, styles.frame, { borderColor: c.glassBorder, backgroundColor: c.glass }, style];
  if (Platform.OS === 'ios') {
    return <BlurView intensity={40} tint={dark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'} style={frame}>{children}</BlurView>;
  }
  return <View style={frame}>{children}</View>;
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
