import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler, Linking, PermissionsAndroid, Platform } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import * as DocumentPicker from 'expo-document-picker';
import EpiqueChat from './EpiqueChat';

type Mic = 'granted' | 'denied' | 'blocked';

/** Asks Android for the microphone with the system dialog (the one reliable path). Never throws. */
export async function ensureMic(): Promise<Mic> {
  if (Platform.OS !== 'android') return 'granted';
  try {
    const P = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (await PermissionsAndroid.check(P)) return 'granted';
    const r = await PermissionsAndroid.request(P, {
      title: 'Microphone',
      message: 'Epique AI needs the microphone so it can hear you.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    if (r === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    return r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  } catch (e) {
    return 'denied';
  }
}

/** Closes the assistant overlay (AssistantActivity turns the default back action into finish()). */
export const closeAssistant = () => { try { BackHandler.exitApp(); } catch (e) {} };

/**
 * Native half of the DOM component. It renders the EpiqueChat page and services the few things a WebView cannot do
 * by itself: persistent storage, speech recognition and the Android microphone / camera permission prompts.
 */
export default function EpiqueHost({ assistant = false }: { assistant?: boolean }) {
  const dom = useRef<any>(null);
  const cur = useRef(0);

  // Everything the page saved last time (keys, chats, settings). Read synchronously so the page never renders without it.
  const store = useMemo(() => {
    try {
      const out: Record<string, string> = {};
      for (const k of Storage.getAllKeysSync()) { const v = Storage.getItemSync(k); if (v != null) out[k] = v; }
      return JSON.stringify(out);
    } catch (e) { return '{}'; }
  }, []);
  const persist = useCallback(async (key: string, value: string | null) => {
    try { if (value == null) Storage.removeItemSync(key); else Storage.setItemSync(key, value); } catch (e) {}
  }, []);

  const emit = useCallback((type: string, payload?: unknown) => {
    if (!cur.current) return;
    try { dom.current?.speechEvent(cur.current, type, payload === undefined ? '' : JSON.stringify(payload)); } catch (e) {}
  }, []);

  useSpeechRecognitionEvent('start', () => emit('start'));
  useSpeechRecognitionEvent('audiostart', () => emit('audiostart'));
  useSpeechRecognitionEvent('speechstart', () => emit('speechstart'));
  useSpeechRecognitionEvent('speechend', () => emit('speechend'));
  useSpeechRecognitionEvent('result', (e) => emit('result', { isFinal: e.isFinal, results: e.results.map((r) => ({ transcript: r.transcript, confidence: r.confidence })) }));
  useSpeechRecognitionEvent('error', (e) => emit('error', { error: e.error, message: e.message }));
  useSpeechRecognitionEvent('end', () => { emit('end'); });

  // Ask for the microphone when the real app opens, until it is granted. Android stops showing the dialog by itself after two
  // refusals, and then the voice screen offers "Open settings". The count is only raised when the user did not allow it.
  useEffect(() => {
    if (assistant) return;
    const t = setTimeout(async () => {
      let asked = 0;
      try { asked = Number(Storage.getItemSync('native.micAsks') || 0); } catch (e) {}
      if (asked >= 2) return;
      const m = await ensureMic();
      if (m !== 'granted') { try { Storage.setItemSync('native.micAsks', String(asked + 1)); } catch (e) {} }
    }, 900);
    return () => clearTimeout(t);
  }, [assistant]);

  const speech = useCallback(async (c: { op: string; id: number; lang?: string; interim?: boolean; continuous?: boolean }) => {
    if (c.op === 'start') {
      cur.current = c.id;
      const m = await ensureMic();
      if (m !== 'granted') { emit('error', { error: 'not-allowed', message: m }); emit('end'); return; }
      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) { emit('error', { error: 'service-not-allowed', message: 'unavailable' }); emit('end'); return; }
        ExpoSpeechRecognitionModule.start({ lang: c.lang || 'en-US', interimResults: !!c.interim, continuous: !!c.continuous });
      } catch (e: any) {
        emit('error', { error: 'service-not-allowed', message: String(e?.message || e) }); emit('end');
      }
    } else if (c.op === 'stop') { try { ExpoSpeechRecognitionModule.stop(); } catch (e) {} }
    else if (c.op === 'abort') { try { ExpoSpeechRecognitionModule.abort(); } catch (e) {} }
  }, [emit]);

  const permissions = useCallback(async ({ audio, video }: { audio?: boolean; video?: boolean }) => {
    if (Platform.OS !== 'android') return true;
    if (audio && (await ensureMic()) !== 'granted') return false;
    if (video) {
      try {
        const P = PermissionsAndroid.PERMISSIONS.CAMERA;
        if (!(await PermissionsAndroid.check(P)) && (await PermissionsAndroid.request(P)) !== PermissionsAndroid.RESULTS.GRANTED) return false;
      } catch (e) { return false; }
    }
    return true;
  }, []);

  // Reads replies aloud with the phone's own voice (works without any cloud key). Resolves when the sentence is done.
  const tts = useCallback((c: { op: string; text?: string; rate?: number; lang?: string }) => {
    if (c.op === 'stop') { try { Speech.stop(); } catch (e) {} return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let over = false; const fin = () => { if (!over) { over = true; resolve(); } };
      try { Speech.speak(c.text || '', { language: c.lang, rate: Math.max(0.5, Math.min(2, c.rate || 1)), onDone: fin, onStopped: fin, onError: fin }); } catch (e) { fin(); }
    });
  }, []);
  // Never leave the phone talking after the screen goes away.
  useEffect(() => () => { try { Speech.stop(); } catch (e) {} }, []);

  // Native file picker (a WebView <input type=file> does nothing here). Returns the chosen files as JSON with base64 bodies.
  const pick = useCallback(async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (r.canceled) return '[]';
      const out: { name: string; mime: string; b64: string }[] = [];
      for (const a of r.assets.slice(0, 6)) {
        if ((a.size || 0) > 8e6) continue;
        const b = await (await fetch(a.uri)).blob();
        const b64 = await new Promise<string>((res) => { const fr = new FileReader(); fr.onloadend = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(b); });
        out.push({ name: a.name, mime: a.mimeType || b.type, b64 });
      }
      return JSON.stringify(out);
    } catch (e) { return '[]'; }
  }, []);

  const close = useCallback(async () => { closeAssistant(); }, []);
  const openSettings = useCallback(async () => { try { await Linking.openSettings(); } catch (e) {} }, []);
  const openApp = useCallback(async () => { try { await Linking.openURL('epique://'); } catch (e) {} closeAssistant(); }, []);

  return (
    <EpiqueChat
      ref={dom}
      dom={{ style: { flex: 1, backgroundColor: 'transparent' }, containerStyle: { flex: 1, backgroundColor: 'transparent' } } as any}
      store={store}
      persist={persist}
      speech={speech}
      permissions={permissions}
      tts={tts}
      close={close}
      pick={pick}
      openSettings={openSettings}
      openApp={openApp}
      assistant={assistant}
    />
  );
}
