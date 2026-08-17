import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Webhook-Secret",
};

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"]);

function isPrivateHostname(host: string): boolean {
  if (host === "169.254.169.254") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function assertPublicHttpUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL is required");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || isPrivateHostname(host)) {
    throw new Error("That host is not allowed");
  }
  return url;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const body = await req.json() as {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
      body?: unknown;
      credentialId?: string;
    };
    const url = assertPublicHttpUrl(String(body.url ?? ""));
    const method = (body.method || "POST").toUpperCase();
    const headers = new Headers(body.headers ?? {});
    if (!headers.has("Content-Type") && body.body != null && method !== "GET" && method !== "HEAD") {
      headers.set("Content-Type", "application/json");
    }

    if (body.credentialId) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: cred } = await supabase.from("credentials").select("id, name, type, value").eq("id", body.credentialId).maybeSingle();
      const value = cred?.value as string | undefined;
      if (value) {
        const type = String(cred?.type ?? "api-key");
        if (type === "basic") headers.set("Authorization", `Basic ${btoa(value)}`);
        else if (!headers.has("Authorization")) headers.set("Authorization", type === "api-key" ? value : `Bearer ${value}`);
      }
    }

    const payload = body.body == null || method === "GET" || method === "HEAD"
      ? undefined
      : typeof body.body === "string"
        ? body.body
        : JSON.stringify(body.body);

    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return new Response(JSON.stringify({
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: parsed,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "HTTP request failed" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
