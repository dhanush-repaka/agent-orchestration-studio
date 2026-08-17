export async function invokeSibling<T = unknown>(
  slug: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: T }> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) {
    return { ok: false, status: 0, data: { error: "Missing Supabase env" } as T };
  }
  try {
    const res = await fetch(`${base}/functions/v1/${slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: err instanceof Error ? err.message : "Network error" } as T,
    };
  }
}
