import { destroySession } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

export async function POST() {
  return handler(async () => {
    destroySession();
    return ok({ ok: true });
  });
}
