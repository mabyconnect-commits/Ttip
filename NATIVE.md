# Ttip — Native iOS & Android Apps

Ttip ships to the App Store and Play Store as a **Capacitor** native shell that
loads the deployed web app (`https://www.ttip.site`) and adds native camera,
haptics, status bar, splash and back-button handling. One codebase; web updates
go live instantly without re-submitting the app.

> Why a server-URL shell (not a static bundle)? Ttip is server-rendered — it has
> live API routes and SSR. A static export can't run those. The shell approach
> keeps the full backend working while giving you real store-installable apps.

---

## Project layout

```
capacitor.config.ts     App id (site.ttip.app), name, server URL, splash/status bar
native/www/index.html   Offline fallback shown only if the server is unreachable
assets/                 Icon + splash source art (logo.png, icon.png)
android/                Android Studio project  (tracked in git)
ios/                    Xcode project           (tracked in git)
src/components/NativeBridge.tsx  Runs only inside the app: hide splash, status bar, back button
```

## npm scripts

```
npm run cap:sync       # copy config + web fallback into both native projects
npm run cap:android    # sync + open Android Studio
npm run cap:ios        # sync + open Xcode (macOS only)
npm run cap:assets     # regenerate icons + splash from assets/ (after logo changes)
```

---

## One-time setup

- **Android:** install Android Studio (bundles the SDK + JDK).
- **iOS (macOS only):** install Xcode + CocoaPods (`sudo gem install cocoapods`),
  then `cd ios/App && pod install` (skipped automatically on non-macOS).

Point the shell at a machine on your LAN for live testing against a dev server:
```
CAP_SERVER_URL=http://192.168.1.20:3000 npm run cap:sync
```

---

## Build & run

### Android (any OS)
```
npm run cap:android        # opens Android Studio
```
- Run on a device/emulator with the ▶ button.
- **Release AAB for Play:** Build → Generate Signed Bundle / APK → Android App
  Bundle. Create/upload a keystore; Play App Signing manages the rest.
- Bump `versionCode` / `versionName` in `android/app/build.gradle` per release.

> **"Unsafe app blocked — built for an older version of Android"**
>
> That Play Protect dialog is about `targetSdkVersion`, not about your code. It
> appears when the APK targets a platform older than the phone's Android version
> allows for a sideloaded install. This project targets **API 35 (Android 15)**
> in `android/variables.gradle`, which is also what Google Play has required for
> new apps and updates since 31 Aug 2025, so an APK built from `android/` will
> not trigger it.
>
> If you see it, the APK almost certainly came from somewhere else — a
> "website → APK" generator wraps your site in a shell that usually targets a
> very old SDK. Build from this project instead.
>
> Raising the target means AGP ≥ 8.6 and Gradle ≥ 8.7 (both bumped here). The
> first build after this change re-downloads Gradle, so give it a few minutes.

### iOS (macOS only)
```
npm run cap:ios            # opens Xcode
```
- Set your Team under Signing & Capabilities (bundle id `site.ttip.app`).
- Product → Archive → Distribute App → App Store Connect.
- Bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` per release.

---

## After changing anything

- **Changed the web app only** → nothing to do; the shell loads the live site, so
  a normal Vercel deploy updates the apps instantly.
- **Changed `capacitor.config.ts`, icons, or native code** → `npm run cap:sync`,
  then rebuild in Android Studio / Xcode and submit a new binary.

---

## Store submission checklist

- [ ] App icon + splash generated (`npm run cap:assets`) — done, from the Ttip logo.
- [ ] Camera usage strings present (Android `CAMERA` permission; iOS
      `NSCameraUsageDescription`) — done, for the QR scanner.
- [ ] Bundle id `site.ttip.app` matches your App Store Connect / Play Console app.
- [ ] Privacy policy + support URL live (Apple & Google both require them).
- [ ] Data-safety / privacy-nutrition forms filled (collects identity for KYC,
      financial info) — declare BVN/identity + transaction data.
- [ ] Screenshots for each required device size.
- [ ] Financial-app review notes: explain Ttip is a licensed/partnered crypto
      off-ramp; provide a test account so reviewers can pass KYC in sandbox.

## Recommended follow-ups (not required to ship)

- **Native QR on iOS:** WKWebView lacks `BarcodeDetector`, so the in-app web
  scanner falls back to "paste address" on iPhone. Add `@capacitor-mlkit/
  barcode-scanning` and call it from the scan button when running natively for a
  native camera scan on both platforms.
- **Push notifications:** add `@capacitor/push-notifications` + FCM/APNs to alert
  users when a deposit lands or a payout completes.
- **Biometric app-lock:** back the existing PIN lock with Face ID / fingerprint
  via `@capacitor/biometric` for faster unlock.
- **In-app checkout browser:** open the Paystack buy checkout with
  `@capacitor/browser` for a smoother return into the app.
