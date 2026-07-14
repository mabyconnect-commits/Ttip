import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { handler, ok, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";

const schema = z.object({
  identifier: z.string().min(1, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});

export async function POST(req: Request) {
  return handler(async () => {
    const { identifier, password } = schema.parse(await req.json());
    const id = identifier.toLowerCase().replace(/^@/, "");
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: id }, { username: id }] },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError("Wrong email/username or password", 401);
    }
    await createSession(user.id);
    const state = await getAppState(user.id);
    return ok(state);
  });
}
