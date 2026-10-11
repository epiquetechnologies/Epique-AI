/**
 * Epique AI: Android "digital assistant" plugin (registers the VoiceInteractionService + translucent AssistantActivity).
 *
 * Registers a VoiceInteractionService so Epique AI shows up under
 * Settings > Apps > Default apps > Digital assistant app. When selected, the system's assistant
 * gesture (power-button hold, home long-press, corner swipe, headset button) opens AssistantActivity:
 * a translucent React Native activity rendering the "assistant" root (a bottom sheet already listening).
 * If the user has "Use screenshot" enabled, the session saves the screen to cache/assist_screen.jpg
 * so the model can see what the user was looking at.
 */
const { withAndroidManifest, withAndroidStyles, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const kt = (pkg) => ({
  'AssistantActivity.kt': `package ${pkg}

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

/** Hosts the "assistant" React root over whatever app the user was in. */
class AssistantActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AssistantTheme)
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "assistant"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {})
  }

  // JS closes the assistant with BackHandler.exitApp(); finish this activity instead of backgrounding the task.
  override fun invokeDefaultOnBackPressed() {
    finish()
  }
}
`,
  'EpiqueVoiceInteractionService.kt': `package ${pkg}

import android.service.voice.VoiceInteractionService

/** Marker service: its presence (plus the metadata XML) makes Epique selectable as the default assistant. */
class EpiqueVoiceInteractionService : VoiceInteractionService()
`,
  'EpiqueVoiceInteractionSessionService.kt': `package ${pkg}

import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

class EpiqueVoiceInteractionSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = EpiqueVoiceInteractionSession(this)
}
`,
  'EpiqueVoiceInteractionSession.kt': `package ${pkg}

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

class EpiqueVoiceInteractionSession(context: Context) : VoiceInteractionSession(context) {
  private val shot: File get() = File(context.cacheDir, "assist_screen.jpg")

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    // Drop any screenshot from a previous invocation so the model never sees stale content.
    runCatching { shot.delete() }
    // The system's own session window stays empty; our UI lives in AssistantActivity.
    setUiEnabled(false)
    startAssistantActivity(Intent(context, AssistantActivity::class.java))
  }

  // Delivered only when the user enabled "Use screenshot" for the default assistant.
  override fun onHandleScreenshot(screenshot: Bitmap?) {
    if (screenshot == null) return
    thread(name = "epique-screenshot") {
      runCatching {
        val max = 1280f
        val scale = minOf(1f, max / maxOf(screenshot.width, screenshot.height))
        val bmp = if (scale < 1f)
          Bitmap.createScaledBitmap(screenshot, (screenshot.width * scale).toInt(), (screenshot.height * scale).toInt(), true)
        else screenshot
        FileOutputStream(shot).use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
      }
    }
  }
}
`,
  'EpiqueRecognitionService.kt': `package ${pkg}

import android.content.Intent
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/**
 * Some Android versions require an assistant to declare a recognition service. Epique does speech
 * recognition in-app through Google's recognizer (pinned in JS), so this stub just reports an error
 * to anything that selects it directly.
 */
class EpiqueRecognitionService : RecognitionService() {
  override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
    runCatching { listener?.error(SpeechRecognizer.ERROR_CLIENT) }
  }
  override fun onCancel(listener: Callback?) {}
  override fun onStopListening(listener: Callback?) {}
}
`,
});

const XML = {
  'voice_interaction_service.xml': `<?xml version="1.0" encoding="utf-8"?>
<voice-interaction-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:sessionService="PKG.EpiqueVoiceInteractionSessionService"
    android:recognitionService="PKG.EpiqueRecognitionService"
    android:supportsAssist="true"
    android:supportsLaunchVoiceAssistFromKeyguard="true" />
`,
  'recognition_service.xml': `<?xml version="1.0" encoding="utf-8"?>
<recognition-service xmlns:android="http://schemas.android.com/apk/res/android" />
`,
};

module.exports = function withEpiqueAssistant(config) {
  const pkg = () => config.android?.package;

  // 1. Kotlin sources + XML metadata
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const p = pkg();
      if (!p) throw new Error('withEpiqueAssistant: set expo.android.package in app.json');
      const main = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main');
      const jdir = path.join(main, 'java', ...p.split('.'));
      fs.mkdirSync(jdir, { recursive: true });
      for (const [name, src] of Object.entries(kt(p))) fs.writeFileSync(path.join(jdir, name), src);
      const xdir = path.join(main, 'res', 'xml');
      fs.mkdirSync(xdir, { recursive: true });
      for (const [name, src] of Object.entries(XML)) fs.writeFileSync(path.join(xdir, name), src.replace(/PKG/g, p));
      return c;
    },
  ]);

  // 2. Translucent theme for the assistant overlay
  config = withAndroidStyles(config, (c) => {
    const styles = c.modResults.resources.style ?? (c.modResults.resources.style = []);
    if (!styles.some((s) => s.$.name === 'AssistantTheme')) {
      styles.push({
        $: { name: 'AssistantTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' },
        item: [
          { $: { name: 'android:windowIsTranslucent' }, _: 'true' },
          { $: { name: 'android:windowBackground' }, _: '@android:color/transparent' },
          { $: { name: 'android:windowNoTitle' }, _: 'true' },
          { $: { name: 'android:windowDisablePreview' }, _: 'true' },
          { $: { name: 'android:windowContentOverlay' }, _: '@null' },
          { $: { name: 'android:backgroundDimEnabled' }, _: 'false' },
          { $: { name: 'android:statusBarColor' }, _: '@android:color/transparent' },
          { $: { name: 'android:navigationBarColor' }, _: '@android:color/transparent' },
          { $: { name: 'android:windowAnimationStyle' }, _: '@android:style/Animation' },
        ],
      });
    }
    return c;
  });

  // 3. Manifest entries
  config = withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    const perms = (c.modResults.manifest['uses-permission'] ??= []);
    for (const name of ['android.permission.RECORD_AUDIO', 'android.permission.CAMERA', 'com.android.alarm.permission.SET_ALARM']) {
      if (!perms.some((x) => x.$['android:name'] === name)) perms.push({ $: { 'android:name': name } });
    }
    // Needed on Android 11+ to resolve tel:, sms:, maps and clock intents.
    const queries = (c.modResults.manifest.queries ??= [{}]);
    const q = queries[0];
    q.intent ??= [];
    for (const a of ['android.intent.action.VIEW', 'android.intent.action.DIAL', 'android.intent.action.SENDTO', 'android.intent.action.SET_TIMER', 'android.intent.action.SET_ALARM']) {
      if (!q.intent.some((i) => i.action?.some((x) => x.$['android:name'] === a))) q.intent.push({ action: [{ $: { 'android:name': a } }] });
    }

    const has = (list, n) => (list ?? []).some((x) => x.$['android:name'] === n);
    app.activity ??= [];
    app.service ??= [];
    if (!has(app.activity, '.AssistantActivity')) {
      app.activity.push({
        $: {
          'android:name': '.AssistantActivity',
          'android:exported': 'true',
          'android:theme': '@style/AssistantTheme',
          'android:launchMode': 'singleTask',
          'android:taskAffinity': '',
          'android:excludeFromRecents': 'true',
          'android:showWhenLocked': 'true',
          'android:windowSoftInputMode': 'adjustResize',
          'android:screenOrientation': 'portrait',
          'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths',
        },
        // ACTION_ASSIST also lets launchers and OEM shortcuts start the overlay directly.
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.ASSIST' } }], category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }] }],
      });
    }
    if (!has(app.service, '.EpiqueVoiceInteractionService')) {
      app.service.push({
        $: { 'android:name': '.EpiqueVoiceInteractionService', 'android:permission': 'android.permission.BIND_VOICE_INTERACTION', 'android:exported': 'true' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.voice.VoiceInteractionService' } }] }],
        'meta-data': [{ $: { 'android:name': 'android.voice_interaction', 'android:resource': '@xml/voice_interaction_service' } }],
      });
    }
    if (!has(app.service, '.EpiqueVoiceInteractionSessionService')) {
      app.service.push({ $: { 'android:name': '.EpiqueVoiceInteractionSessionService', 'android:permission': 'android.permission.BIND_VOICE_INTERACTION', 'android:exported': 'true' } });
    }
    if (!has(app.service, '.EpiqueRecognitionService')) {
      app.service.push({
        $: { 'android:name': '.EpiqueRecognitionService', 'android:permission': 'android.permission.RECORD_AUDIO', 'android:exported': 'true' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.speech.RecognitionService' } }], category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }] }],
        'meta-data': [{ $: { 'android:name': 'android.speech', 'android:resource': '@xml/recognition_service' } }],
      });
    }
    return c;
  });

  return config;
};
