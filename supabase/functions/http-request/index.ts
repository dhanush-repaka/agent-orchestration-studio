import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { hostnameAllowedForCredential, isBlockedHostname } from "../_shared/ssrf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Webhook-Secret",
};

function assertPublicHttpUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL is required");
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error("That host is not allowed");
  }
  return url;
}

function credentialAllowedHost(cred: Record<string, unknown>): string {
  const direct = cred.allowed_host ?? cred.allowedHost;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (typeof cred.value === "string") {
    try {
      const parsed = JSON.parse(cred.value) as { allowed_host?: string; allowedHost?: string };
      const nested = parsed.allowed_host ?? parsed.allowedHost;
      if (typeof nested === "string") return nested.trim();
    } catch {
      // plain secret
    }
  }
  return "";
}

function credentialSecret(cred: Record<string, unknown>): string {
  const value = cred.value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as { value?: string; token?: string; secret?: string };
      return String(parsed.value ?? parsed.token ?? parsed.secret ?? value);
    } catch {
      return value;
    }
  }
  return "";
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
      const { data: cred } = await supabase.from("credentials").select("*").eq("id", body.credentialId).maybeSingle();
      const rec = (cred ?? {}) as Record<string, unknown>;
      const allowedHost = credentialAllowedHost(rec);
      if (!allowedHost || !hostnameAllowedForCredential(url.hostname, allowedHost)) {
        throw new Error("Credential is not allowed for that host");
      }
      const value = credentialSecret(rec);
      if (value) {
        const type = String(rec.type ?? "api-key");
        if (type === "basic") headers.set("Authorization", `Basic ${btoa(value)}`);
        else if (!headers.has("Authorization")) headers.set("Authorization", type === "api-key" ? value : `Bearer ${value}`);
      }
    }

    const payload = body.body == null || method === "GET" || method === "HEAD"
      ? undefined
      : typeof body.body === "string"
        ? body.body
        : JSON.stringify(body.body);

    const res = await fetch(url, { method, headers, body: payload, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      throw new Error("Redirects are not allowed");
    }
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
