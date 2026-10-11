import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import EpiqueHost from './components/EpiqueHost';

/** The regular app: the original page, full screen, on its original #050505 backdrop. */
export default function App() {
  return (
    <View style={{ flex: 1, backgroundColor: '#050505' }}>
      <StatusBar style="light" />
      <EpiqueHost />
    </View>
  );
}
