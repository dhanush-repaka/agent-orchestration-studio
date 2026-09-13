import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isBlockedHostname } from "../_shared/ssrf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeLlmUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (isBlockedHostname(url.hostname)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isSafeModelId(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(value);
}

function publicError(text: string): string {
  return text.replace(/sk-[a-zA-Z0-9_-]+/g, "sk-***").slice(0, 300);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let body: { baseUrl?: string; model?: string; apiKey?: string; useStudioSecret?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const useStudio = body.useStudioSecret !== false && !body.apiKey;
  const apiKey = (body.apiKey?.trim() || Deno.env.get("LLM_API_KEY") || "").trim();
  const fallbackBase = (Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const baseUrl = sanitizeLlmUrl(body.baseUrl || fallbackBase);
  const model = isSafeModelId((body.model ?? "").trim()) ? body.model!.trim() : (Deno.env.get("LLM_MODEL") || "gpt-4o-mini");

  if (!baseUrl) {
    return json(400, { ok: false, error: "Enter an https API endpoint that is not a private host." });
  }
  if (!apiKey) {
    return json(400, { ok: false, error: useStudio ? "Studio LLM_API_KEY is not configured." : "Enter an API key to test this model." });
  }

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the word pong." }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const raw = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return json(200, {
        ok: false,
        latencyMs,
        model,
        error: publicError(`LLM returned ${res.status}: ${raw}`),
      });
    }
    return json(200, { ok: true, latencyMs, model, status: "connected" });
  } catch (err) {
    return json(200, {
      ok: false,
      latencyMs: Date.now() - started,
      model,
      error: publicError(err instanceof Error ? err.message : "Network error"),
    });
  }
});
