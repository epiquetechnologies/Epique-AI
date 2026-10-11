/**
 * Runs INSIDE the DOM component (the WebView). It only activates when the page is hosted by React Native
 * (window.ReactNativeWebView exists AND the WebView lacks the feature), so a normal browser behaves exactly
 * as the original JSX did. It adds no UI: it only gives the page the browser APIs Android WebView is missing.
 *
 *  - SpeechRecognition  -> bridged to expo-speech-recognition on the native side
 *  - getUserMedia       -> asks for the Android RECORD_AUDIO / CAMERA runtime permission first
 */
type Actions = {
  pick?: () => Promise<string>;
  speech?: (c: { op: string; id: number; lang?: string; interim?: boolean; continuous?: boolean }) => Promise<void>;
  permissions?: (p: { audio?: boolean; video?: boolean }) => Promise<boolean>;
  close?: () => Promise<void>;
  openSettings?: () => Promise<void>;
  openApp?: () => Promise<void>;
  persist?: (key: string, value: string | null) => Promise<void>;
  /** The phone's own text-to-speech voice. 'speak' resolves when the sentence has finished (or was stopped). */
  tts?: (c: { op: string; text?: string; rate?: number; lang?: string }) => Promise<void>;
};

export const actions: Actions = {};
export const setActions = (a: Actions) => { Object.assign(actions, a); };

const w: any = typeof window !== "undefined" ? window : null;
export const inHost = !!(w && (w.ReactNativeWebView || w.ExpoDomWebViewBridge || /; wv\)/.test(navigator.userAgent || "")));


/**
 * Persistent storage. The WebView's own localStorage is not reliable here (it is per-WebView, so the main app and the
 * assistant overlay never saw each other's keys, and it can be wiped), so when the native host hands us a snapshot we
 * replace window.localStorage with a shim that is backed by native storage (SQLite key-value store).
 */
let storageReady = false;
export const installStorage = (json?: string): boolean => {
  if (storageReady) return true;
  if (!w || json === undefined) return false;
  storageReady = true;
  const keep = new Map<string, string>();
  try { const d = JSON.parse(json || "{}"); for (const k of Object.keys(d)) if (typeof d[k] === "string") keep.set(k, d[k]); } catch (e) {}
  const save = (k: string, v: string | null) => { try { const r = actions.persist?.(k, v); if (r && (r as any).catch) (r as any).catch(() => {}); } catch (e) {} };
  // One-time migration: keep anything an older build left in the WebView's own storage.
  try {
    const real = w.localStorage;
    for (let i = 0; real && i < real.length; i++) { const k = real.key(i); if (k && !keep.has(k)) { const v = real.getItem(k); if (v != null) { keep.set(k, v); save(k, v); } } }
  } catch (e) {}
  const shim = {
    getItem: (k: any) => (keep.has(String(k)) ? (keep.get(String(k)) as string) : null),
    setItem: (k: any, v: any) => { const key = String(k), val = String(v); keep.set(key, val); save(key, val); },
    removeItem: (k: any) => { const key = String(k); keep.delete(key); save(key, null); },
    clear: () => { for (const k of [...keep.keys()]) save(k, null); keep.clear(); },
    key: (i: number) => [...keep.keys()][i] ?? null,
    get length() { return keep.size; },
  };
  try { Object.defineProperty(w, "localStorage", { value: shim, configurable: true, writable: true }); } catch (e) {}
  return true;
};

let nextId = 1;
const live = new Map<number, any>();

/** Called by the native side (through useDOMImperativeHandle) for every recognizer event. */
export const speechEvent = (id: number, type: string, json: string) => {
  const r = live.get(id); if (!r) return;
  const p = json ? JSON.parse(json) : {};
  if (type === "result") {
    const list = (p.results || []).slice(0, 1).map((x: any) => x);
    const alt: any = list.map((x: any) => ({ transcript: x.transcript || "", confidence: x.confidence ?? 1 }));
    alt.isFinal = !!p.isFinal;
    r._fire("result", { resultIndex: 0, results: [alt] });
    return;
  }
  if (type === "end") live.delete(id);
  if (type === "error") r._fire("error", { error: p.error || "aborted", message: p.message || "" });
  else r._fire(type, {});
};

class NativeSpeechRecognition {
  lang = "en-US"; interimResults = false; continuous = false; maxAlternatives = 1;
  onstart: any = null; onend: any = null; onerror: any = null; onresult: any = null; onspeechstart: any = null; onspeechend: any = null; onaudiostart: any = null; onaudioend: any = null; onnomatch: any = null;
  _id = 0;
  _fire(name: string, ev: any) { const f = (this as any)["on" + name]; if (typeof f === "function") { try { f.call(this, ev); } catch (e) { console.error(e); } } }
  start() {
    if (this._id && live.has(this._id)) throw new DOMException("recognition has already started", "InvalidStateError");
    this._id = nextId++; live.set(this._id, this);
    const send = actions.speech;
    if (!send) { queueMicrotask(() => { this._fire("error", { error: "service-not-allowed" }); this._fire("end", {}); live.delete(this._id); }); return; }
    send({ op: "start", id: this._id, lang: this.lang, interim: this.interimResults, continuous: this.continuous }).catch(() => speechEvent(this._id, "error", JSON.stringify({ error: "service-not-allowed" })));
  }
  stop() { if (this._id) actions.speech?.({ op: "stop", id: this._id }); }
  abort() { if (this._id) actions.speech?.({ op: "abort", id: this._id }); }
  addEventListener(n: string, f: any) { (this as any)["on" + n] = f; }
  removeEventListener(n: string, f: any) { if ((this as any)["on" + n] === f) (this as any)["on" + n] = null; }
}

// Android WebView ships neither constructor; Chromium (and the plain-web build) keep their own.
if (w && (inHost || (!w.SpeechRecognition && !w.webkitSpeechRecognition))) { w.SpeechRecognition = NativeSpeechRecognition; w.webkitSpeechRecognition = NativeSpeechRecognition; }

if (inHost) {
  // (the speech polyfill is installed below, outside this block, so it never depends on how the host is detected)

  const md = navigator.mediaDevices as any;
  if (md?.getUserMedia && !md.__epiqueWrapped) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c: any) => {
      if (actions.permissions) {
        const ok = await actions.permissions({ audio: !!c?.audio, video: !!c?.video }).catch(() => false);
        if (!ok) throw new DOMException("Permission denied", "NotAllowedError");
      }
      return orig(c);
    };
    md.__epiqueWrapped = true;
  }
}
