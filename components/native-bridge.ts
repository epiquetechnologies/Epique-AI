/**
 * Runs INSIDE the DOM component (the WebView). It only activates when the page is hosted by React Native
 * (window.ReactNativeWebView exists AND the WebView lacks the feature), so a normal browser behaves exactly
 * as the original JSX did. It adds no UI: it only gives the page the browser APIs Android WebView is missing.
 *
 *  - SpeechRecognition  -> bridged to expo-speech-recognition on the native side
 *  - getUserMedia       -> asks for the Android RECORD_AUDIO / CAMERA runtime permission first
 */
type Actions = {
  speech?: (c: { op: string; id: number; lang?: string; interim?: boolean; continuous?: boolean }) => Promise<void>;
  permissions?: (p: { audio?: boolean; video?: boolean }) => Promise<boolean>;
  close?: () => Promise<void>;
  openSettings?: () => Promise<void>;
};

export const actions: Actions = {};
export const setActions = (a: Actions) => { Object.assign(actions, a); };

const w: any = typeof window !== "undefined" ? window : null;
const inHost = !!(w && w.ReactNativeWebView);

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

if (inHost) {
  // Android WebView ships neither constructor; Chromium (and the plain-web build) keep their own.
  if (!w.SpeechRecognition && !w.webkitSpeechRecognition) { w.SpeechRecognition = NativeSpeechRecognition; w.webkitSpeechRecognition = NativeSpeechRecognition; }

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
