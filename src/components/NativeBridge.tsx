"use client";

import { useEffect } from "react";

/**
 * Native shell bridge. On iOS/Android (inside the Capacitor WebView) this wires
 * up the small things that make the web app feel like a real app: hide the
 * splash once React has painted, style the status bar to our dark chrome, and
 * make the Android hardware back button navigate history (or exit at the root).
 *
 * On the web it's an inert no-op — the Capacitor modules are imported lazily and
 * only touched when running natively, so nothing ships to the browser bundle
 * path that would break SSR.
 */
export function NativeBridge() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const [{ SplashScreen }, { StatusBar, Style }, { App }] = await Promise.all([
        import("@capacitor/splash-screen"),
        import("@capacitor/status-bar"),
        import("@capacitor/app"),
      ]);

      // Dark chrome → light status-bar icons.
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      SplashScreen.hide().catch(() => {});

      // Android hardware back: go back in history, or minimise at the root.
      const sub = await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else App.minimizeApp();
      });
      cleanup = () => sub.remove();
    })();

    return () => cleanup?.();
  }, []);

  return null;
}
