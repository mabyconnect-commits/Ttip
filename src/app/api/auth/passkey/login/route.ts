import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { handler, ok, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { rpId, allowedOrigins, stashChallenge, takeChallenge } from "@/lib/webauthn";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Signing in with Face ID or a fingerprint.
 *
 * GET  → a challenge to sign
 * POST → verify the signature and start the session
 *
 * No username is asked for. The credential the phone signs with tells us which
 * account it belongs to, so there is nothing to type and nothing to guess. The
 * biometric never leaves the device: it unlocks a private key held in the
 * phone's secure hardware, and we only ever see a signature.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const options = await generateAuthenticationOptions({
      rpID: rpId(),
      // Empty: any passkey for this site may answer, which is what makes a
      // usernameless sign-in possible.
      allowCredentials: [],
      userVerification: "required",
    });
    await stashChallenge(options.challenge, "login");
    return ok({ options });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    // A signature can't be brute-forced, but the endpoint can still be hammered.
    rateLimit(`passkey:${clientIp(req)}`, { limit: 20, windowMs: 5 * 60_000 });

    const expected = await takeChallenge("login");
    if (!expected) throw new ApiError("That took too long — try again.", 400);

    const body = (await req.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null;
    const response = body?.response;
    if (!response?.id) throw new ApiError("Nothing to verify", 400);

    const passkey = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
    if (!passkey) throw new ApiError("That device isn't registered for any account.", 401);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: expected,
      expectedOrigin: allowedOrigins(),
      expectedRPID: rpId(),
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
        counter: Number(passkey.counter),
        transports: passkey.transports as never,
      },
    }).catch((e: unknown) => {
      console.error("[passkey] authentication failed", e);
      return null;
    });

    if (!verification?.verified) throw new ApiError("That didn't verify — use your password instead.", 401);

    // The counter only ever goes up. A replayed assertion carries an old one,
    // and a cloned authenticator eventually produces one too.
    const seen = Number(verification.authenticationInfo.newCounter);
    if (seen > 0 && seen <= Number(passkey.counter)) {
      throw new ApiError("That sign-in couldn't be trusted. Use your password.", 401);
    }

    await prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: BigInt(seen), lastUsedAt: new Date() },
    });

    await createSession(passkey.userId);
    return ok(await getAppState(passkey.userId));
  });
}
