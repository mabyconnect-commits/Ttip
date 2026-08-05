import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { rpId, rpName, allowedOrigins, stashChallenge, takeChallenge, deviceLabel } from "@/lib/webauthn";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Adding Face ID / a fingerprint to an account you are already signed into.
 *
 * GET  → the options the browser needs to create a credential
 * POST → verify what it created, and store the PUBLIC key
 *
 * Registration requires an existing session on purpose: a passkey is a way to
 * sign in again, never a way to claim an account. Proving who you are still
 * happens with the password first.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many devices one account may register. */
const MAX_PASSKEYS = 10;

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, name: true, passkeys: { select: { credentialId: true, transports: true } } },
    });
    if (!user) return unauthorized();
    if (user.passkeys.length >= MAX_PASSKEYS) {
      throw new ApiError("That's the most devices we can hold for one account — remove one first.", 400);
    }

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId(),
      userName: user.username,
      userDisplayName: user.name,
      // Never the database id: a user handle is stored on the device and shown
      // in some password managers, so it should carry nothing about the row.
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      // Registering the same authenticator twice leaves a dead entry the user
      // can't tell apart from the live one.
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as never,
      })),
      authenticatorSelection: {
        // The phone itself, not a plugged-in key — Face ID, Touch ID, the
        // fingerprint sensor. Discoverable so signing in needs no username.
        residentKey: "preferred",
        userVerification: "required",
      },
    });

    await stashChallenge(options.challenge, "register");
    return ok({ options });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const expected = await takeChallenge("register");
    if (!expected) throw new ApiError("That took too long — try again.", 400);

    const body = (await req.json().catch(() => null)) as { response?: RegistrationResponseJSON } | null;
    if (!body?.response) throw new ApiError("Nothing to verify", 400);

    const verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: expected,
      expectedOrigin: allowedOrigins(),
      expectedRPID: rpId(),
      requireUserVerification: true,
    }).catch((e: unknown) => {
      console.error("[passkey] registration failed", e);
      return null;
    });

    if (!verification?.verified || !verification.registrationInfo) {
      throw new ApiError("That device couldn't be verified. Try again.", 400);
    }

    const { credential } = verification.registrationInfo;
    const label = deviceLabel(req.headers.get("user-agent"));

    await prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: BigInt(credential.counter),
        transports: (credential.transports ?? []) as string[],
        label,
      },
    });

    return ok({ added: label });
  });
}
