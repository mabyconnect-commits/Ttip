import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { pushPublicKey, pushConfigured, notifyUser } from "@/lib/push";

/**
 * Registering a device for push, and removing it again.
 *
 * GET    → the public VAPID key (and whether push is switched on at all)
 * POST   → store this device's subscription
 * DELETE → forget it
 *
 * A subscription identifies a DEVICE, not a person, and is worthless without
 * the keys stored beside it — but it is still tied to the signed-in user here,
 * so one account's notifications can never be routed to another's phone.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const count = await prisma.pushSubscription.count({ where: { userId } });
    return ok({ configured: pushConfigured(), publicKey: pushPublicKey(), devices: count });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    if (!pushConfigured()) throw new ApiError("Push isn't switched on for this deployment yet.", 503);

    const body = schema.parse(await req.json());

    // Upsert on the endpoint: the same device re-subscribing (permission
    // re-granted, keys rotated by the browser) must move to this account
    // rather than leave a stale row pointing at the previous one.
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      update: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });

    // Prove it works immediately. A notification permission granted in silence
    // leaves the user unsure anything happened.
    await notifyUser(userId, {
      title: "Notifications on",
      body: "We'll tell you the moment money lands in your Ttip wallet.",
      url: "/home",
      tag: "welcome",
    });

    return ok({ enabled: true });
  });
}

export async function DELETE(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const endpoint = new URL(req.url).searchParams.get("endpoint");

    // No endpoint given: turn this account's notifications off everywhere.
    await prisma.pushSubscription.deleteMany({
      where: endpoint ? { userId, endpoint } : { userId },
    });
    return ok({ enabled: false });
  });
}
