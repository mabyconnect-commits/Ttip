/**
 * Which install route a device actually has.
 *
 * iOS has no `beforeinstallprompt` and never will — Apple doesn't allow a site
 * to trigger an install. The only way onto an iPhone home screen is the user
 * tapping Share → Add to Home Screen themselves, so the app's job is to show
 * them exactly where that is.
 *
 * Dependency-free so it can be unit-tested against real user-agent strings.
 */

export type InstallRoute =
  /** Chrome/Edge/Android: the browser fires an install event we can replay. */
  | "prompt"
  /** iOS Safari, Chrome, Edge, Firefox: manual Share → Add to Home Screen. */
  | "ios-share"
  /** Instagram/Facebook/TikTok/WhatsApp browsers: can't install at all. */
  | "open-in-browser"
  /** Already installed, or nothing useful to offer. */
  | "none";

export interface Env {
  userAgent: string;
  /** navigator.maxTouchPoints — how an iPad is told apart from a Mac. */
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
}

/**
 * True for iPhone, iPod AND modern iPad.
 *
 * iPadOS 13+ reports itself as "Macintosh" — a plain /iPad/ test, which is what
 * this used to do, misses every current iPad. A Mac has no touch points; an iPad
 * has five.
 */
export function isIos(env: Env): boolean {
  const ua = env.userAgent ?? "";
  if (/iPhone|iPod/.test(ua)) return true;
  if (/iPad/.test(ua)) return true;
  return /Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1;
}

/** An embedded webview — Instagram, Facebook, TikTok, WhatsApp, Snapchat. */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|Snapchat|WhatsApp|Twitter|Pinterest/i.test(userAgent ?? "");
}

/** Whether the app is already running from the home screen. */
export function isInstalled(env: Env): boolean {
  return env.standalone === true || env.displayModeStandalone === true;
}

/**
 * The label for the browser's share control, which is not in the same place in
 * every iOS browser — Safari puts it in the bottom bar, Chrome and Edge in the
 * menu. Naming the browser is what turns "tap Share" into a findable step.
 */
export function iosBrowserName(userAgent: string): string {
  if (/CriOS/.test(userAgent)) return "Chrome";
  if (/EdgiOS/.test(userAgent)) return "Edge";
  if (/FxiOS/.test(userAgent)) return "Firefox";
  if (/OPiOS|OPT\//.test(userAgent)) return "Opera";
  return "Safari";
}

/** Where that browser keeps the Share button. */
export function iosShareHint(userAgent: string): string {
  const name = iosBrowserName(userAgent);
  if (name === "Safari") return "the bar at the bottom of the screen";
  if (name === "Chrome") return "the ••• menu, top right";
  if (name === "Edge") return "the ••• menu at the bottom";
  if (name === "Firefox") return "the ••• menu, bottom right";
  return "the browser menu";
}

export function installRoute(env: Env, hasPromptEvent: boolean): InstallRoute {
  if (isInstalled(env)) return "none";
  // An in-app webview can't install anything, on either platform. Saying "tap
  // Share" there sends the user hunting for a button that isn't present.
  if (isInAppBrowser(env.userAgent)) return "open-in-browser";
  if (hasPromptEvent) return "prompt";
  if (isIos(env)) return "ios-share";
  return "none";
}
