import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EVERY = /^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours)$/i;

function scheduleIntervalMs(expr: string): number | null {
  const every = expr.trim().match(EVERY);
  if (!every) return null;
  const n = Number(every[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return every[2].toLowerCase().startsWith("h") ? n * 3600_000 : n * 60_000;
}

function cronMatches(expr: string, at: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const values = [at.getUTCMinutes(), at.getUTCHours(), at.getUTCDate(), at.getUTCMonth() + 1, at.getUTCDay()];
  return parts.every((field, i) => field === "*" || Number(field) === values[i]);
}

function isDue(expr: string, lastScheduledAt: string | undefined, now: Date): boolean {
  const trimmed = expr?.trim();
  if (!trimmed) return false;
  const last = lastScheduledAt ? new Date(lastScheduledAt).getTime() : 0;
  if (Number.isNaN(last)) return false;
  const interval = scheduleIntervalMs(trimmed);
  if (interval != null) return now.getTime() - last >= interval;
  if (!cronMatches(trimmed, now)) return false;
  return now.getTime() - last >= 50_000;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await supabase.from("workflows").select("id, data");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const queued: string[] = [];
  for (const row of rows ?? []) {
    const data = (row.data ?? {}) as {
      triggerType?: string;
      scheduleCron?: string;
      lastScheduledAt?: string;
      defaultInput?: string;
    };
    if (data.triggerType !== "scheduled" || !data.scheduleCron) continue;
    if (!isDue(data.scheduleCron, data.lastScheduledAt, now)) continue;
    const id = `trg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let payload: unknown = {};
    try { payload = data.defaultInput ? JSON.parse(data.defaultInput) : {}; } catch { payload = { raw: data.defaultInput }; }
    await supabase.from("workflow_triggers").insert({
      id,
      workflow_id: row.id,
      kind: "schedule",
      payload,
      status: "queued",
    });
    await supabase.from("workflows").upsert({
      id: row.id,
      data: { ...data, lastScheduledAt: now.toISOString() },
      updated_at: now.toISOString(),
    });
    queued.push(row.id);
  }

  return new Response(JSON.stringify({ ok: true, queued }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
