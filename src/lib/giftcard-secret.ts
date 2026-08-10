import "server-only";
import crypto from "crypto";

/**
 * Encrypting a gift card code at rest.
 *
 * The code IS the money. Anyone who reads it can spend it, it cannot be
 * cancelled, and there is nobody to call — which makes it closer to a private
 * key than to a transaction record. A database dump that hands over plaintext
 * codes is a dump that hands over the cards.
 *
 * AES-256-GCM, keyed off AUTH_SECRET. GCM rather than CBC because it is
 * authenticated: a tampered ciphertext fails to decrypt instead of returning
 * plausible rubbish that we'd then show someone as their card.
 *
 * The key is derived, not used raw, so AUTH_SECRET doesn't have to be exactly
 * 32 bytes and so this key isn't the same bytes as the session-signing key.
 */

function key(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not set.");
  return crypto.createHash("sha256").update(`giftcard:${s}`).digest();
}

/** iv.tag.ciphertext, base64url, in one field. */
export function sealCode(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

/**
 * Returns null rather than throwing on anything malformed.
 *
 * A card that can't be decrypted is a support problem, not a crash: the screen
 * should say "we couldn't read this one, contact support" and stay up, because
 * the user probably has other cards on it that are fine.
 */
export function openCode(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * What the list can show without decrypting anything.
 *
 * Enough for someone to recognise which card is which, useless to anyone who
 * reads it over their shoulder or finds it in a log.
 */
export function codeHint(plain: string): string {
  const clean = plain.replace(/\s+/g, "");
  return clean.length <= 4 ? "••••" : `••••${clean.slice(-4)}`;
}
