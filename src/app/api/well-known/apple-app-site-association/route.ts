import { NextResponse } from "next/server";

/**
 * iOS Universal Links — /.well-known/apple-app-site-association (rewritten here).
 *
 * The website half of Universal Links. iOS fetches this once at install and
 * only then will a ttip.site link open the app instead of Safari.
 *
 * Set APPLE_APP_ID to "<TEAM ID>.<bundle id>", e.g. ABCDE12345.site.ttip.app —
 * the Team ID is in the Apple Developer account under Membership. Xcode also
 * needs the Associated Domains capability with `applinks:ttip.site`; without
 * both halves nothing changes and links keep opening in the browser.
 *
 * Served as JSON with no extension, exactly as Apple requires, and unsigned —
 * which is what Apple has expected since iOS 9.
 */

export const dynamic = "force-dynamic";

export function GET() {
  const appId = (process.env.APPLE_APP_ID ?? "").trim();

  const body = appId
    ? {
        applinks: {
          details: [
            {
              appIDs: [appId],
              components: [
                // Everything except the API and the auth pages, which have no
                // business being handed to an app UI.
                { "/": "/api/*", exclude: true },
                { "/": "/*" },
              ],
            },
          ],
        },
      }
    : { applinks: { details: [] } };

  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
