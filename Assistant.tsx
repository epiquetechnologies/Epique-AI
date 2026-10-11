import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import EpiqueHost from './components/EpiqueHost';

/** Shown by the Android assistant gesture: the same page over a transparent window (the app underneath stays visible). */
export default function Assistant() {
  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <StatusBar style="light" />
      <EpiqueHost assistant />
    </View>
  );
}
