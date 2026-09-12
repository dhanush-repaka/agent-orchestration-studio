import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { invokeSibling } from "../_shared/invoke.ts";
import { timingSafeEqual } from "../_shared/ssrf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Webhook-Secret",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST a JSON payload to trigger the workflow" });

  try {
    const url = new URL(req.url);
    const workflowId = url.searchParams.get("workflowId") || url.searchParams.get("id");
    const secret = req.headers.get("x-webhook-secret") || url.searchParams.get("secret") || "";
    const payload = await req.json().catch(() => ({}));

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows, error } = await supabase.from("workflows").select("id, data");
    if (error) {
      console.error("workflow-webhook load failed", error);
      return json(401, { error: "Invalid webhook secret" });
    }

    const match = (rows ?? []).find((row) => {
      const data = (row.data ?? {}) as { webhookSecret?: string };
      const expected = data.webhookSecret ?? "";
      if (!expected) return false;
      if (workflowId && row.id !== workflowId) return false;
      return timingSafeEqual(expected, secret);
    });
    if (!match) return json(401, { error: "Invalid webhook secret" });

    const id = `trg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { error: insertError } = await supabase.from("workflow_triggers").insert({
      id,
      workflow_id: match.id,
      kind: "webhook",
      payload,
      status: "queued",
    });
    if (insertError) {
      console.error("workflow-webhook insert failed", insertError);
      return json(401, { error: "Invalid webhook secret" });
    }

    const { data: agentRows } = await supabase.from("agents").select("data");
    const agents = (agentRows ?? []).map((row) => row.data);
    const dispatched = await invokeSibling<{ runId?: string }>("execute-workflow", {
      workflowId: match.id,
      workflow: match.data,
      agents,
      runtimeInput: JSON.stringify(payload ?? {}),
      triggeredBy: "webhook",
    });
    if (dispatched.ok) {
      await supabase.from("workflow_triggers").update({
        status: "consumed",
        consumed_at: new Date().toISOString(),
      }).eq("id", id);
      return json(202, {
        ok: true,
        triggerId: id,
        workflowId: match.id,
        status: "running",
        runId: dispatched.data.runId,
      });
    }

    return json(202, { ok: true, triggerId: id, workflowId: match.id, status: "queued" });
  } catch (err) {
    console.error("workflow-webhook failed", err);
    return json(401, { error: "Invalid webhook secret" });
  }
});
