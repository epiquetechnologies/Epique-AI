import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import EpiqueHost, { closeAssistant } from './components/EpiqueHost';

const CARD_H = 300;

function Overlay() {
  const insets = useSafeAreaInsets();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Native backdrop: tapping anywhere outside the card always closes the overlay, even if the page inside is slow. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t, backgroundColor: 'rgba(0,0,0,0.32)' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeAssistant} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[
          styles.card,
          {
            marginBottom: insets.bottom + 12,
            opacity: t,
            transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
          },
        ]}
      >
        <EpiqueHost assistant />
      </Animated.View>
    </View>
  );
}

/** Shown by the Android assistant gesture: a small voice card over a transparent window (the app underneath stays visible). */
export default function Assistant() {
  return (
    <SafeAreaProvider style={{ backgroundColor: 'transparent' }}>
      <Overlay />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
  card: { height: CARD_H, marginHorizontal: 12, borderRadius: 30, overflow: 'hidden', backgroundColor: '#0a0a0a' },
});
