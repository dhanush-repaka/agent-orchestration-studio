import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface UploadRequest {
  testCases: Array<{
    id?: string;
    title: string;
    description?: string;
    preconditions?: string[];
    requirementId?: string;
    priority?: string;
    type?: string;
    expectedOutcome?: string;
  }>;
  sourceWorkItemId?: number | string;
}

const PRIORITY_MAP: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as UploadRequest;

    if (!body || !Array.isArray(body.testCases) || body.testCases.length === 0) {
      return new Response(
        JSON.stringify({ error: "testCases (non-empty array) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adoOrg = Deno.env.get("ADO_ORG");
    const apiVersion = Deno.env.get("ADO_API_VERSION") ?? "7.0";

    if (!adoOrg) {
      return new Response(
        JSON.stringify({ error: "ADO_ORG secret is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: credRow, error: credError } = await supabase
      .from("credentials")
      .select("value")
      .eq("name", "Azure DevOps PAT")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (credError) {
      return new Response(
        JSON.stringify({ error: `Failed to read credential: ${credError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adoPat = credRow?.value ?? "";

    if (!adoPat) {
      return new Response(
        JSON.stringify({ error: "Azure DevOps PAT not found in credentials table. Please add it in the Credentials page." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let cleanOrg = String(adoOrg).trim();
    if (cleanOrg.includes("://")) {
      const urlParts = cleanOrg.split("/");
      const afterDomain = urlParts.slice(3).filter(Boolean);
      cleanOrg = afterDomain[0] ?? "";
    }
    cleanOrg = cleanOrg.replace(/[^a-zA-Z0-9_-]/g, "");

    const patAuth = btoa(`:${adoPat}`);
    const authHeaders = {
      "Authorization": `Basic ${patAuth}`,
      "Accept": "application/json",
    };

    // Discover the project name from the source work item if available.
    let projectName = "";
    let sourceWorkItemUrl = "";
    if (body.sourceWorkItemId) {
      const wiUrl = `https://dev.azure.com/${cleanOrg}/_apis/wit/workitems/${body.sourceWorkItemId}?api-version=${apiVersion}`;
      const wiRes = await fetch(wiUrl, { headers: authHeaders });
      if (wiRes.ok) {
        const wiJson = await wiRes.json();
        const areaPath: string = wiJson.fields?.["System.AreaPath"] ?? "";
        if (areaPath) {
          projectName = areaPath.split("\\")[0] ?? "";
        }
        sourceWorkItemUrl = wiJson.url ?? "";
      }
    }

    if (!projectName) {
      return new Response(
        JSON.stringify({ error: "Could not determine the ADO project name from the source work item. Ensure sourceWorkItemId is provided and the work item exists." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const encodedProject = encodeURIComponent(projectName);
    const results: Array<{ title: string; success: boolean; workItemId?: number; url?: string; error?: string }> = [];

    for (const tc of body.testCases) {
      const title = tc.title ?? "Untitled Test Case";
      const description = tc.description ?? "";
      const preconditionsRaw = tc.preconditions;
      const preconditions = Array.isArray(preconditionsRaw)
        ? preconditionsRaw.join("\n- ")
        : (typeof preconditionsRaw === "string" ? preconditionsRaw : "");
      const priorityVal = PRIORITY_MAP[tc.priority ?? "medium"] ?? 3;
      const expectedOutcome = tc.expectedOutcome ?? "";

      const fullDescription = preconditions
        ? `${description}\n\nPreconditions:\n- ${preconditions}`
        : description;

      const stepsXml = `<steps><step id="1" type="ActionStep"><description>${escapeXml(description)}</description><expectedResult>${escapeXml(expectedOutcome)}</expectedResult></step></steps>`;

      const document: Array<Record<string, unknown>> = [
        { op: "add", path: "/fields/System.Title", value: title },
        { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: priorityVal },
        { op: "add", path: "/fields/System.Description", value: fullDescription },
        { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: stepsXml },
        { op: "add", path: "/fields/System.Tags", value: "AI-Orchestration-Agent" },
      ];

      if (body.sourceWorkItemId && sourceWorkItemUrl) {
        document.push({
          op: "add",
          path: "/relations/-",
          value: {
            rel: "Microsoft.VSTS.Common.TestedBy-Reverse",
            url: sourceWorkItemUrl,
            attributes: { name: "Tested By" },
          },
        });
      }

      const createUrl = `https://dev.azure.com/${cleanOrg}/${encodedProject}/_apis/wit/workitems/$Test%20Case?api-version=${apiVersion}`;

      try {
        const createRes = await fetch(createUrl, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json-patch+json",
          },
          body: JSON.stringify(document),
        });

        if (createRes.ok) {
          const created = await createRes.json();
          results.push({
            title,
            success: true,
            workItemId: created.id,
            url: created.url,
          });
        } else {
          const errText = await createRes.text();
          results.push({
            title,
            success: false,
            error: `ADO create failed (${createRes.status}): ${errText}`,
          });
        }
      } catch (err) {
        results.push({
          title,
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;

    return new Response(
      JSON.stringify({
        sourceWorkItemId: body.sourceWorkItemId ?? null,
        projectName,
        totalTestCases: results.length,
        succeeded,
        failed,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Unexpected error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
