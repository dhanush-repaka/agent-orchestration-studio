import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

    const adoOrg = (body.adoOrg && String(body.adoOrg).trim()) || Deno.env.get("ADO_ORG");
    const llmApiKey = Deno.env.get("LLM_API_KEY");
    const llmBaseUrl = (Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const llmModel = "gpt-4o-mini";
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
      return new Response(
        JSON.stringify({ error: `Failed to read credential: ${credError.message}` }),
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
      return new Response(
        JSON.stringify({ error: `Azure DevOps request failed (${adoRes.status}): ${adoErr}`, requestUrl: usedUrl, attemptedUrls: [adoUrl, altAdoUrl] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const workItem = await adoRes.json();
    const fields = workItem.fields ?? {};

    const normalized: Record<string, unknown> = {
      id: workItem.id ?? cleanId,
      title: fields["System.Title"] ?? null,
      description: fields["System.Description"] ?? null,
      state: fields["System.State"] ?? null,
      assignedTo: fields["System.AssignedTo"]?.displayName ?? null,
      workItemType: fields["System.WorkItemType"] ?? null,
      acceptanceCriteria: fields["Microsoft.VSTS.Common.AcceptanceCriteria"] ?? null,
      tags: fields["System.Tags"] ? String(fields["System.Tags"]).split(";").map((t: string) => t.trim()) : [],
      createdDate: fields["System.CreatedDate"] ?? null,
      changedDate: fields["System.ChangedDate"] ?? null,
      areaPath: fields["System.AreaPath"] ?? null,
      iterationPath: fields["System.IterationPath"] ?? null,
      priority: fields["Microsoft.VSTS.Common.Priority"] ?? null,
      boardColumn: fields["System.BoardColumn"] ?? null,
    };

    if (llmApiKey) {
      const systemPrompt =
        "You are a data retrieval specialist for Azure DevOps. Given a raw work item, extract and normalize its key fields into a clean JSON object. Return ONLY valid JSON with these fields: id, title, description, state, assignedTo, workItemType, acceptanceCriteria, tags, createdDate, changedDate. Use null for any field that is not present in the source work item. Do not include commentary or markdown fences.";
      const userPrompt = `Normalize this Azure DevOps work item:\n\n${JSON.stringify(workItem)}`;

      try {
        const llmRes = await fetch(`${llmBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${llmApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: llmModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0,
            max_tokens: 2000,
          }),
        });

        if (llmRes.ok) {
          const llmJson = await llmRes.json();
          const content: string = llmJson.choices?.[0]?.message?.content ?? "";
          try {
            const cleaned = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();
            const llmNormalized = JSON.parse(cleaned);
            return new Response(
              JSON.stringify({
                workItemId: cleanId,
                rawWorkItem: { id: workItem.id, rev: workItem.rev, url: workItem.url, fields },
                normalized: llmNormalized,
                extractedFields: normalized,
                llmUsage: llmJson.usage ?? null,
              }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          } catch {
            // LLM returned non-JSON, fall through to extracted fields
          }
        }
      } catch {
        // LLM call failed, fall through to extracted fields
      }
    }

    return new Response(
      JSON.stringify({
        workItemId: cleanId,
        rawWorkItem: { id: workItem.id, rev: workItem.rev, url: workItem.url, fields },
        normalized,
        llmUsage: null,
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
