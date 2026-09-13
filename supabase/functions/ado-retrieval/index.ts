import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { serverAdoOrg } from "../_shared/ssrf.ts";
import { normalizeAdoFields } from "../_shared/adoWorkItem.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RetrieveRequest {
  workItemId: number | string;
  adoOrg?: string;
  adoApiVersion?: string;
  adoPat?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RetrieveRequest;
    const { workItemId } = body;
    const parsedId = typeof workItemId === "number" ? workItemId : Number(workItemId);
    if (!workItemId || Number.isNaN(parsedId)) {
      return new Response(
        JSON.stringify({ error: "workItemId (number) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adoOrg = serverAdoOrg();
    const apiVersion = (body.adoApiVersion && String(body.adoApiVersion).trim()) || Deno.env.get("ADO_API_VERSION") || "7.0";

    if (!adoOrg) {
      return new Response(
        JSON.stringify({ error: "ADO_ORG secret is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Read the PAT from the credentials table using the service role key.
    // The service role key bypasses RLS, so it can read the value column
    // even though anon/authenticated cannot.
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
      console.error("ado-retrieval credential read failed", credError);
      return new Response(
        JSON.stringify({ error: "Could not load the Azure DevOps credential" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const incomingPat = typeof body.adoPat === "string" ? body.adoPat.trim() : "";
    const adoPat = incomingPat || credRow?.value || Deno.env.get("ADO_PAT") || "";

    if (incomingPat) {
      await supabase.from("credentials").upsert({
        id: "c1",
        name: "Azure DevOps PAT",
        type: "api-key",
        value: incomingPat,
        environment: "production",
        updated_at: new Date().toISOString(),
      });
    }

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
    const cleanId = parseInt(String(parsedId), 10);
    if (isNaN(cleanId)) {
      return new Response(
        JSON.stringify({ error: `Invalid work item ID: ${workItemId}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adoUrl = `https://dev.azure.com/${cleanOrg}/_apis/wit/workitems/${cleanId}?api-version=${apiVersion}`;
    const altAdoUrl = `https://${cleanOrg}.visualstudio.com/_apis/wit/workitems/${cleanId}?api-version=${apiVersion}`;
    const patAuth = btoa(`:${adoPat}`);
    let adoRes = await fetch(adoUrl, {
      headers: {
        "Authorization": `Basic ${patAuth}`,
        "Accept": "application/json",
      },
    });
    let usedUrl = adoUrl;
    if (!adoRes.ok && adoRes.status === 404) {
      adoRes = await fetch(altAdoUrl, {
        headers: {
          "Authorization": `Basic ${patAuth}`,
          "Accept": "application/json",
        },
      });
      usedUrl = altAdoUrl;
    }

    if (!adoRes.ok) {
      const adoErr = await adoRes.text();
      console.error("ado-retrieval ADO request failed", adoRes.status, usedUrl, adoErr);
      return new Response(
        JSON.stringify({ error: "Could not load the work item" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const workItem = await adoRes.json();
    const fields = workItem.fields ?? {};
    const normalized = normalizeAdoFields(fields, workItem.id ?? cleanId);

    return new Response(
      JSON.stringify({
        workItemId: cleanId,
        rawWorkItem: { id: workItem.id, rev: workItem.rev, url: workItem.url, fields },
        normalized,
        extractedFields: normalized,
        source: "azure-devops",
        llmUsage: null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("ado-retrieval failed", err);
    return new Response(
      JSON.stringify({ error: "Could not load the work item" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
