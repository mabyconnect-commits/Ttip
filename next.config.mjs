/** @type {import('next').NextConfig} */

// A pragmatic, app-compatible Content-Security-Policy. The browser only ever
// talks to our own origin (`/api/*`); crypto/FX prices are fetched server-side,
// fonts are self-hosted by next/font, and QR codes render as inline data URLs.
// `'unsafe-inline'` on script/style is required for Next's hydration bootstrap
// and styled-jsx; everything else is locked to 'self'.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://assets.coingecko.com",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Force HTTPS for two years, including subdomains (only honoured over HTTPS).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // `microphone=()` means "nobody, including us" — it blocked the mic in our
  // OWN document, so Ada's voice input showed "Listening…" forever and never
  // heard a word. Both camera and microphone are (self): this origin may ask,
  // and no embedded frame can. Everything else stays denied outright.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig = {
  reactStrictMode: true,
  // The receipt renderer needs its bundled font at RUNTIME. Nothing imports the
  // .ttf files, so tracing wouldn't include them and every receipt would come
  // out as empty boxes — which is exactly what happened.
  outputFileTracingIncludes: {
    "/api/telegram/webhook": ["./src/assets/fonts/**", "./public/icon-192.png"],
  },
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "assets.coingecko.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // The two files the phones fetch to decide whether our app is allowed to
  // open ttip.site links. They live under /.well-known, which App Router
  // can't express as a folder (a leading dot isn't a route segment), and
  // Apple's has no file extension at all — so both are served from routes.
  async rewrites() {
    return [
      { source: "/.well-known/assetlinks.json", destination: "/api/well-known/assetlinks" },
      {
        source: "/.well-known/apple-app-site-association",
        destination: "/api/well-known/apple-app-site-association",
      },
    ];
  },
};

export default nextConfig;
