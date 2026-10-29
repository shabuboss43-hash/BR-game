# X Battle Royale — Android APK

## Download & install (Android 10 and newer)

1. Get `X-Battle-Royale-Android10.apk` from the repo's **Releases** page
   (or from a green **Actions → Build Android APK** run → Artifacts).
2. Copy it to your phone and tap it.
3. Android will ask to allow "install from this source" (debug-signed
   apps need this) → allow → Install.
4. Launch **X Battle Royale**. No internet needed — everything
   (including the soldier models in `assets/models/`) is inside the APK.

- Package: `com.shabuboss.xbattleroyale` · minSdk 24 (Android 7+) so
  **Android 10 (API 29) is fully supported** · targetSdk 34
- Fullscreen landscape, screen stays awake, no permissions except
  INTERNET (declared by Capacitor; the game itself is offline), no ads,
  no accounts.

## How the APK is built

Capacitor 6 wraps the web game in a native Android shell (WebView):

```
game.js + src/ + Three.js  --(esbuild, Chrome-80 bundle)--> www/
www/ + assets/models/*.glb --(npx cap sync android)--> android/ app
android/                   --(Gradle assembleDebug)--> app-debug.apk
```

The APK uses a **bundled** script instead of the browser build's import
map, because import maps require Chrome 89+ while an Android 10 WebView
can be older. The browser version in the repo root is unchanged.

### Build in the cloud (what this repo does)

`.github/workflows/build-apk.yml` runs automatically on changes to the
game/Android project and uploads `X-Battle-Royale-Android10.apk` as a
build artifact. You can also start it manually: **Actions → Build
Android APK → Run workflow**.

### Build locally (optional)

Requires Node 20+, JDK 17 and Android SDK platform 34 (Android Studio
provides them):

```bash
npm ci
npm run android:apk
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Notes

- This is a **debug-signed** APK: perfect for installing on your own
  phone and sharing directly. For Google Play you would need a signed
  release AAB with your own keystore (never commit keystores to git).
- APK size is mostly the two soldier models (~22 MB of textures).
  Compressing their textures would shrink the APK and load times.
- If the game ever opens to a white screen and stays there, update
  **Android System WebView** (or Chrome) from the Play Store — WebGL and
  modern JS come from it.
