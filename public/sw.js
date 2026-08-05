/*
 * Ttip service worker.
 *
 * Exists mainly so the app is installable — Chrome only offers "Install app"
 * for a page with a manifest AND a service worker that handles fetch.
 *
 * SAFETY FIRST: this is a money app, so the rule is that nothing which could
 * misrepresent someone's balance is ever served from cache.
 *
 *   - /api/**            → NEVER cached, never intercepted. Balances, rates,
 *                          payouts and KYC always hit the network. A stale
 *                          balance is worse than no balance.
 *   - navigations        → network first, cache only as an offline fallback,
 *                          and only for the shell.
 *   - static assets      → cache first (hashed filenames, so they're immutable).
 *
 * Bump CACHE_VERSION to retire old caches on deploy.
 */

const CACHE_VERSION = "ttip-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll([OFFLINE_URL, "/icon-192.png", "/icon-512.png"]))
      .catch(() => {
        /* an asset missing must never block installation */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only ever touch same-origin GETs. Anything else (POST /api/send, a
  // cross-origin price feed) goes straight to the network untouched.
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Money data is never cached, and never even read from cache.
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations: always try the network so the user sees live data;
  // fall back to the offline page only when the network is genuinely gone.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? Response.error();
      }),
    );
    return;
  }

  // Static assets: cache first. Next.js fingerprints these, so a cached copy
  // is always the right copy.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|ttf|css|js)$/.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          // Only store complete, successful responses.
          if (res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});

// Lets a new version take over immediately when the app asks it to.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/* -------------------------------------------------------------------------- */
/* Push notifications                                                          */
/* -------------------------------------------------------------------------- */

/*
 * A deposit landing is the one moment a user wants to hear from us without
 * opening anything. The payload carries only what's safe on a lock screen —
 * an amount and what happened — never an account number or a balance.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload still deserves a notification rather than silence,
    // because the alternative is a user who never learns their money arrived.
    data = { title: "Ttip", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Ttip";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    // Same tag replaces rather than stacks, but must still buzz: a second
    // deposit is news too.
    renotify: !!data.tag,
    data: { url: data.url || "/notifications" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/*
 * Tapping it goes to the app. If a Ttip window is already open, focus that one
 * and steer it — opening a second copy of a wallet is disorienting.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin)) {
          return client.focus().then((c) => (c && c.navigate ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
