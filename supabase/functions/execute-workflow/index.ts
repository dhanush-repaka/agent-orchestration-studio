import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { executeWorkflow, type ReplayResume } from "../_shared/engine.ts";
import { invokeSibling } from "../_shared/invoke.ts";
import type { Agent, Workflow, WorkflowRun } from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function waitUntil(work: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST a workflow payload to execute" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({})) as {
    runId?: string;
    workflowId?: string;
    workflow?: Workflow;
    agents?: Agent[];
    runtimeInput?: string;
    triggeredBy?: string;
    resume?: ReplayResume | null;
  };

  let workflow = body.workflow;
  if (!workflow?.nodes && body.workflowId) {
    const { data, error } = await supabase.from("workflows").select("data").eq("id", body.workflowId).maybeSingle();
    if (error) return json(500, { error: error.message });
    workflow = data?.data as Workflow | undefined;
  }
  if (!workflow?.nodes) return json(400, { error: "Workflow is required" });

  let agents = body.agents;
  if (!agents) {
    const { data } = await supabase.from("agents").select("data");
    agents = (data ?? []).map((row) => row.data as Agent);
  }

  const runId = body.runId || `r${Date.now()}`;
  let cancelled = false;
  let approval = new Map<string, boolean>();

  const pollSignals = async () => {
    while (!cancelled) {
      const { data } = await supabase.from("workflow_runs").select("data").eq("id", runId).maybeSingle();
      const run = data?.data as WorkflowRun | undefined;
      if (run?.status === "cancelled") cancelled = true;
      if (run?.approvalNodeId && typeof run.approvalDecision === "boolean") {
        approval.set(run.approvalNodeId, run.approvalDecision);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const persist = async (run: WorkflowRun) => {
    const next = cancelled ? { ...run, status: "cancelled" as const } : run;
    await supabase.from("workflow_runs").upsert({
      id: next.id,
      data: next,
      updated_at: new Date().toISOString(),
    });
  };

  const work = (async () => {
    void pollSignals();
    try {
      const run = await executeWorkflow({
        workflow,
        agents: agents ?? [],
        runtimeInput: body.runtimeInput,
        triggeredBy: body.triggeredBy ?? "server",
        runId,
        resume: body.resume ?? undefined,
        delayMs: 80,
        invoke: invokeSibling,
        persistProgress: persist,
        callbacks: {
          isCancelled: () => cancelled,
          onNodeStatus: () => {},
          waitForApproval: async (nodeId) => {
            const deadline = Date.now() + 10 * 60 * 1000;
            while (Date.now() < deadline && !cancelled) {
              if (approval.has(nodeId)) return approval.get(nodeId) === true;
              await new Promise((r) => setTimeout(r, 1000));
            }
            return false;
          },
        },
      });
      await persist(run);
      return run;
    } finally {
      cancelled = true;
    }
  })();

  waitUntil(work);
  const hasWaitUntil = Boolean((globalThis as { EdgeRuntime?: { waitUntil?: unknown } }).EdgeRuntime?.waitUntil);
  if (!hasWaitUntil) {
    const run = await work;
    return json(200, run);
  }
  return json(202, { ok: true, runId, status: "running" });
});
