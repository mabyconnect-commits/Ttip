import { redirect } from "next/navigation";

export default function JoinPage({ searchParams }: { searchParams: { ref?: string } }) {
  const ref = searchParams.ref;
  redirect(ref ? `/signup?ref=${encodeURIComponent(ref)}` : "/signup");
}
