import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { invokeSibling } from "../_shared/invoke.ts";

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
    if (error) return json(500, { error: error.message });

    const match = (rows ?? []).find((row) => {
      const data = (row.data ?? {}) as { webhookSecret?: string; triggerType?: string };
      if (workflowId && row.id === workflowId) return !data.webhookSecret || data.webhookSecret === secret;
      if (!workflowId && secret && data.webhookSecret === secret) return true;
      return false;
    });
    if (!match) return json(404, { error: "Workflow not found. Save it in the studio first." });

    const data = (match.data ?? {}) as { webhookSecret?: string; triggerType?: string };
    if (data.webhookSecret && data.webhookSecret !== secret) return json(401, { error: "Invalid webhook secret" });

    const id = `trg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { error: insertError } = await supabase.from("workflow_triggers").insert({
      id,
      workflow_id: match.id,
      kind: "webhook",
      payload,
      status: "queued",
    });
    if (insertError) return json(500, { error: insertError.message });

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
    return json(400, { error: err instanceof Error ? err.message : "Webhook failed" });
  }
});
