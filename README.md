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
