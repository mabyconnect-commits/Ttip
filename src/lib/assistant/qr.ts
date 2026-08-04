import "server-only";

/**
 * Read a QR code out of a photo.
 *
 * Someone showing you a wallet address almost always shows a QR, not 42
 * characters of base58 — nobody reads those aloud and nobody types them
 * correctly. A photograph of the screen is how the address actually travels.
 *
 * Decoded properly rather than by asking a model to "read" it: a QR carries a
 * checksum and error correction, so a real decoder either returns the exact
 * payload or fails. A model looking at a QR would be guessing, and a guessed
 * crypto address is money gone with nobody to call.
 */

/**
 * The decoded payload, or null when there's no readable QR.
 *
 * Tries the image as-is, then progressively larger and higher-contrast, because
 * a photo of a phone screen is usually skewed, dim and moiré-patterned. Cheap
 * attempts first.
 */
export async function decodeQr(image: Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const jsQR = (await import("jsqr")).default;

    const attempts: ((s: import("sharp").Sharp) => import("sharp").Sharp)[] = [
      (s) => s,
      (s) => s.resize(1000, 1000, { fit: "inside", withoutEnlargement: false }),
      (s) => s.resize(1400, 1400, { fit: "inside", withoutEnlargement: false }).greyscale().normalise(),
      (s) => s.resize(1400, 1400, { fit: "inside", withoutEnlargement: false }).greyscale().threshold(128),
    ];

    for (const prepare of attempts) {
      try {
        const { data, info } = await prepare(sharp(image))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const found = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
          inversionAttempts: "attemptBoth",
        });
        if (found?.data) return found.data;
      } catch {
        /* this preparation failed — try the next */
      }
    }
    return null;
  } catch (e) {
    console.error("[qr] decode unavailable", e);
    return null;
  }
}
