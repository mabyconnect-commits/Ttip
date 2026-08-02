import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Ttip native shell (iOS + Android).
 *
 * Ttip is server-rendered (live API routes + SSR), so the native app loads the
 * deployed site rather than a static bundle — one codebase, real store apps, and
 * web updates ship instantly without re-submitting. Native camera, haptics,
 * status bar, splash and the in-app browser make it a first-class app, not a
 * thin wrapper.
 *
 * Point it at a different origin for local testing:
 *   CAP_SERVER_URL=http://192.168.1.20:3000 npx cap sync
 */
const serverUrl = process.env.CAP_SERVER_URL || "https://www.ttip.site";

const config: CapacitorConfig = {
  appId: "site.ttip.app",
  appName: "Ttip",
  // Fallback bundle shown only if the server can't be reached (offline splash).
  webDir: "native/www",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    // Allow navigation within our own domain; external links (checkout, explorer)
    // open in the in-app browser / system browser.
    allowNavigation: ["www.ttip.site", "ttip.site"],
  },
  backgroundColor: "#07080D",
  ios: {
    contentInset: "always",
    backgroundColor: "#07080D",
  },
  android: {
    backgroundColor: "#07080D",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#07080D",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK", // dark content on our dark chrome → light icons
      backgroundColor: "#07080D",
    },
    Keyboard: {
      resize: "native",
    },
  },
};

export default config;
