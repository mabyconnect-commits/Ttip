import { NextResponse } from "next/server";

/**
 * Android App Links — /.well-known/assetlinks.json (rewritten here).
 *
 * This is the half of App Links that lives on the website: Android fetches it
 * and will only let the app claim ttip.site links if the signing fingerprint
 * below matches the installed app. Without it, `autoVerify` in the manifest
 * quietly does nothing and links open in a browser tab.
 *
 * Set ANDROID_CERT_SHA256 to the SHA-256 of the signing certificate — from Play
 * Console → Setup → App integrity (use the fingerprint Google signs releases
 * with, not the upload key, or installs from the Play Store won't verify):
 *
 *   ANDROID_CERT_SHA256=AB:CD:…:EF
 *
 * Several fingerprints (an upload key as well, or a debug build) can be given
 * comma-separated. With nothing set this serves an empty list, which is the
 * honest answer — "no app is authorised" — rather than a broken claim.
 */

export const dynamic = "force-dynamic";

const PACKAGE = process.env.ANDROID_PACKAGE_NAME || "site.ttip.app";

function fingerprints(): string[] {
  return (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(s));
}

export function GET() {
  const certs = fingerprints();
  const body = certs.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: PACKAGE,
            sha256_cert_fingerprints: certs,
          },
        },
      ]
    : [];

  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/json",
      // Short enough that adding the fingerprint takes effect the same day.
      "Cache-Control": "public, max-age=300",
    },
  });
}
