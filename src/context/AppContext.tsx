"use client";

import { createContext, useContext, useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { AppState } from "@/lib/types";
import { apiGet, apiPost } from "@/lib/client";

interface Toast {
  id: number;
  msg: string;
  tone: "good" | "bad" | "info";
}

interface Ctx {
  state: AppState;
  refresh: () => Promise<void>;
  action: <T extends Partial<AppState>>(path: string, body?: unknown, method?: "POST" | "PATCH") => Promise<T>;
  logout: () => Promise<void>;
  toast: (msg: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ initial, children }: { initial: AppState; children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initial);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const router = useRouter();
  const tid = useRef(0);

  const toast = useCallback((msg: string, tone: Toast["tone"] = "info") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await apiGet<AppState>("/api/wallet");
      setState((prev) => ({ ...prev, ...s }));
    } catch {
      /* ignore */
    }
  }, []);

  // Merge any response that carries fresh portfolio/user/card into state.
  const action = useCallback(async <T extends Partial<AppState>>(path: string, body?: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> => {
    const res = await apiPost<T>(path, body, method);
    setState((prev) => {
      const next = { ...prev };
      const r = res as Partial<AppState>;
      if (r.user) next.user = r.user;
      if (r.portfolio) next.portfolio = r.portfolio;
      if (r.card !== undefined) next.card = r.card;
      return next;
    });
    return res;
  }, []);

  const logout = useCallback(async () => {
    await apiPost("/api/auth/logout");
    router.push("/");
    router.refresh();
  }, [router]);

  // periodic silent refresh to keep prices/balances current
  useEffect(() => {
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <AppCtx.Provider value={{ state, refresh, action, logout, toast, toasts }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
