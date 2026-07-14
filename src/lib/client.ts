// Client-side fetch helper.

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json as T;
}

export async function apiPost<T = any>(path: string, body?: unknown, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json as T;
}
