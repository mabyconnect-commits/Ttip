import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { getAppState } from "@/lib/serialize";
import { AppProvider } from "@/context/AppContext";
import { Toasts } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const uid = await getUserId();
  if (!uid) redirect("/");
  const state = await getAppState(uid);
  if (!state) redirect("/");

  return (
    <AppProvider initial={state}>
      {children}
      <Toasts />
    </AppProvider>
  );
}
