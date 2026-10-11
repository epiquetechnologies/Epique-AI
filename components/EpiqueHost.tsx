import { useCallback, useRef } from 'react';
import { BackHandler, PermissionsAndroid, Platform } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import EpiqueChat from './EpiqueChat';

/**
 * Native half of the DOM component. It renders the unchanged EpiqueChat page and services the few things a
 * WebView cannot do by itself: speech recognition and the Android microphone / camera permission prompts.
 */
export default function EpiqueHost({ assistant = false }: { assistant?: boolean }) {
  const dom = useRef<any>(null);
  const cur = useRef(0);

  const emit = useCallback((type: string, payload?: unknown) => {
    if (!cur.current) return;
    dom.current?.speechEvent(cur.current, type, payload === undefined ? '' : JSON.stringify(payload));
  }, []);

  useSpeechRecognitionEvent('start', () => emit('start'));
  useSpeechRecognitionEvent('audiostart', () => emit('audiostart'));
  useSpeechRecognitionEvent('speechstart', () => emit('speechstart'));
  useSpeechRecognitionEvent('speechend', () => emit('speechend'));
  useSpeechRecognitionEvent('result', (e) => emit('result', { isFinal: e.isFinal, results: e.results.map((r) => ({ transcript: r.transcript, confidence: r.confidence })) }));
  useSpeechRecognitionEvent('error', (e) => emit('error', { error: e.error, message: e.message }));
  useSpeechRecognitionEvent('end', () => { emit('end'); });

  const speech = useCallback(async (c: { op: string; id: number; lang?: string; interim?: boolean; continuous?: boolean }) => {
    if (c.op === 'start') {
      const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      cur.current = c.id;
      if (!p.granted) { emit('error', { error: 'not-allowed' }); emit('end'); return; }
      ExpoSpeechRecognitionModule.start({ lang: c.lang || 'en-US', interimResults: !!c.interim, continuous: !!c.continuous });
    } else if (c.op === 'stop') ExpoSpeechRecognitionModule.stop();
    else if (c.op === 'abort') ExpoSpeechRecognitionModule.abort();
  }, [emit]);

  const permissions = useCallback(async ({ audio, video }: { audio?: boolean; video?: boolean }) => {
    if (Platform.OS !== 'android') return true;
    const need: any[] = [];
    if (audio) need.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (video) need.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (!need.length) return true;
    const r = await PermissionsAndroid.requestMultiple(need);
    return need.every((n) => r[n] === PermissionsAndroid.RESULTS.GRANTED);
  }, []);

  const close = useCallback(async () => { BackHandler.exitApp(); }, []);

  return <EpiqueChat ref={dom} dom={{ style: { flex: 1, backgroundColor: 'transparent' }, containerStyle: { backgroundColor: 'transparent' } } as any} speech={speech} permissions={permissions} close={close} assistant={assistant} />;
}
