# Epique AI — Expo twin of EpiqueChat.jsx

`components/EpiqueChat.tsx` is the original `EpiqueChat.jsx` carried over unchanged (every card, tool, renderer, style, animation), with only:
- `'use dom'` at the top (Expo DOM component: the page runs as real React DOM inside the app's WebView, so the UI is the same code and renders the same),
- type annotations, `import.meta.env` → `process.env.EXPO_PUBLIC_*`,
- the `INL` markdown regex built with `new RegExp(...)` (Expo's Babel preset strips named groups from regex literals),
- optional host props (below). Nothing visual changed.

## Native layer (no UI)
- `components/native-bridge.ts` (runs in the page): only activates inside the app WebView. Supplies `SpeechRecognition` (Android WebView has none) and asks for mic/camera permission before `getUserMedia`.
- `components/EpiqueHost.tsx` (native): speech via `expo-speech-recognition`, permission prompts, close action.
- `patches/@expo+dom-webview+57.0.1.patch` (applied by `postinstall`): enables DOM storage (localStorage → chats/keys persist), WebChromeClient mic/camera grant, `window.open`/`target=_blank`/`tel:`/`mailto:` → external apps.
- `plugins/withEpiqueAssistant.js`: Android VoiceInteractionService + translucent `AssistantActivity` (root `"assistant"`, `Assistant.tsx`) so Epique can be chosen under Settings → Apps → Default apps → Digital assistant. In that mode tapping the dimmed area above the sheet (or Back) closes it.

## Run
```
npm install
npx expo prebuild --platform android
npx expo run:android          # needs a dev build (native modules), not Expo Go
```
Set your Gemini key in Settings (or `EXPO_PUBLIC_GEMINI_API_KEY`). Typecheck: `npx tsc --noEmit` (0 errors).

## Verified vs not
Verified (headless Chromium, 390×844@2x, mocked Gemini): original vs this build's DOM bundle across 26 UI states: 29 differing pixels in total once the continuously animating logo is masked.
Not verified: anything on a real Android device/emulator (no Android SDK here): the Kotlin patch, assistant gesture, expo-speech-recognition bridge, camera/mic prompts.
Known: blob downloads, getDisplayMedia (screen share) are not supported by Android WebView; the original's hard-coded Maps key should be rotated.

## What changed in v2 (smoothness, settings, assistant)
- **Settings persist.** The page's own localStorage is replaced by a shim backed by native storage (`expo-sqlite/kv-store`), loaded before the first render and shared by the app and the assistant overlay. Keys (Gemini, ElevenLabs), voice, font and chats now survive restarts, and the assistant no longer asks for the key again. Each key field has an explicit **Save** button and a Saved / Not set state.
- **Permissions.** The microphone is requested with the system dialog (`PermissionsAndroid`) on first launch and whenever voice starts; "blocked" shows an *Open settings* button.
- **Assistant overlay.** Native backdrop (tap anywhere outside to close) plus a small card; `AssistantActivity` finishes itself as soon as it is stopped, so it can no longer sit invisibly over the screen. Without a saved key the card shows an *Open Epique AI* button.
- **UI.** No pill behind the header (icons fade out when idle, return on touch); settings and chats are minimal modals (chats are grouped with previews and a ⋯ menu); fonts are tappable chips; the voice picker is an inline list. All `backdrop-filter` blur is gone and the sheet no longer re-renders the chat while dragging.
- Removed: PIN lock, profiles UI, MCP connectors, widgets list, backup/import, logo colour, reduce-motion toggle, Maps key field (the build-time key still works).

## What changed in v3 (verified in a headless browser, not just typechecked)
- **Header.** The "border" behind the top icons was a CSS collision: the header used the class names `hd` / `hr`, which the Markdown renderer also uses for headings and horizontal rules, so the right-hand icons were squashed into a 1px gradient line. The header now has unique class names (`eptBar`, `eptL`, `eptR`), no background at all, and its icons fade after 2.8 s and return on touch. The Home model title had the same kind of clash with the model list (`.mod`) and is fixed too.
- **Voice never needs a key.** Replies and Live mode are read aloud with the phone's own voice (`expo-speech`, native action `tts`). ElevenLabs is optional: with a key saved the voice picker appears, without one Settings just says "Phone voice". The repeating "ElevenLabs key missing" message is gone.
- **Saved settings are guaranteed to be loaded before the page renders** (the page waits for the saved snapshot inside the app), so the Gemini key is never "forgotten" in the app or the assistant overlay.
- **Microphone.** The system permission dialog is requested on app start until it is granted (Android stops showing it itself after two refusals, then Live offers *Open settings*), and again whenever voice starts.
- **Sheet.** The drag handle's hit area is a small centred strip instead of a full-width bar that swallowed taps over the header and modals; dragging no longer re-lays-out the whole page (`contain`).
- **Fonts.** The whole font list is preloaded when Settings opens, so every chip previews in its own typeface; picking one applies and persists.

Checks run for this version: `npx tsc --noEmit` (0 errors), `npx expo prebuild --platform android` (plugin output reviewed against the generated `MainActivity`), `npx expo export --platform android` (app bundle + DOM bundle compile), and a headless Chromium walk-through at 390x844 (header, idle fade, settings, key save, fonts, chats, models, assistant card with and without a key, spoken reply without any key). Still not run on a physical Android device.

