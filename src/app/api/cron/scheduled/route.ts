import { NextResponse } from "next/server";
import { runDueTransfers } from "@/lib/scheduled-transfer";
import { sendMessage } from "@/lib/telegram";
import { notifyUser } from "@/lib/push";
import { prisma } from "@/lib/db";
import { formatFiat } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Send the transfers whose time has come.
 *
 * Wired to Vercel Cron every minute via vercel.json, and protected by
 * CRON_SECRET the same way the withdrawal reconciler is. Claiming is done with
 * a conditional update inside runDueTransfers, so two overlapping runs cannot
 * both pay the same transfer.
 *
 * The result is told to the user wherever they set it up. A scheduled payment
 * that goes out in silence is one they have to go and check, which is most of
 * the reassurance scheduling was supposed to buy them.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const bearer = req.headers.get("authorization");
    const ok = url.searchParams.get("key") === secret || bearer === `Bearer ${secret}`;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = await runDueTransfers();

  for (const r of results) {
    const money = formatFiat(r.amount, r.fiat);
    const who = r.accountName ? ` to ${r.accountName}` : "";
    const text = r.ok
      ? `Sent ✅ ${money}${who} — the transfer you scheduled.`
      : `Your scheduled ${money} transfer${who} didn't go through.\n\n${r.message}\n\nNothing was taken. Send it again when you're ready.`;

    if (r.chatId) await sendMessage(r.chatId, text).catch(() => {});

    // And a push, for the person who set it up in the app rather than the chat.
    const row = await prisma.scheduledTransfer.findUnique({ where: { id: r.id }, select: { userId: true } });
    if (row) {
      await notifyUser(row.userId, {
        title: r.ok ? "Scheduled transfer sent" : "Scheduled transfer failed",
        body: r.ok ? `${money}${who}` : r.message,
        url: "/notifications",
      });
    }
  }

  return NextResponse.json({ ok: true, ran: results.length, sent: results.filter((r) => r.ok).length });
}
