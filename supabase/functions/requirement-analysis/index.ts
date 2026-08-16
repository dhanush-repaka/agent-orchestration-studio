import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VALID_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "gpt-4.1-mini", "gpt-4.1"];
const FALLBACK_MODEL = "gpt-4o-mini";

function resolveModel(envModel: string | undefined): string {
  if (!envModel) return FALLBACK_MODEL;
  if (VALID_MODELS.includes(envModel)) return envModel;
  return FALLBACK_MODEL;
}

async function callLlm(
  apiKey: string,
  baseUrl: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number,
): Promise<{ llmJson: Record<string, unknown> | null; usedModel: string; error: string | null }> {
  const envModel = Deno.env.get("LLM_MODEL");
  const models = [resolveModel(envModel)];
  if (envModel && !VALID_MODELS.includes(envModel)) {
    models.push(FALLBACK_MODEL);
  }

  for (const model of models) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      });
      if (!res.ok) {
        const errText = await res.text();
        if (model === models[models.length - 1]) {
          return { llmJson: null, usedModel: model, error: `LLM request failed (${res.status}): ${errText}` };
        }
        continue;
      }
      const json = await res.json();
      return { llmJson: json as Record<string, unknown>, usedModel: model, error: null };
    } catch (err) {
      if (model === models[models.length - 1]) {
        return { llmJson: null, usedModel: model, error: err instanceof Error ? err.message : "Network error" };
      }
    }
  }
  return { llmJson: null, usedModel: FALLBACK_MODEL, error: "All model attempts failed" };
}

interface RequirementAnalysisRequest {
  adoWorkItem: {
    id?: number | string;
    title?: string;
    description?: string;
    state?: string;
    assignedTo?: string;
    workItemType?: string;
    acceptanceCriteria?: string;
    tags?: string[];
    createdDate?: string;
    changedDate?: string;
  };
}

const SYSTEM_PROMPT =
  "You are a senior business analyst. Given a normalized Azure DevOps work item, analyze the requirement and produce a structured analysis. Return ONLY valid JSON with these fields: workItemId, title, businessObjective (string), acceptanceCriteria (array of strings), qualityScore (number 0-100), gaps (array of strings describing missing or unclear requirements), riskLevel ('low'|'medium'|'high'), recommendation (string). Do not include markdown fences or commentary.";

function buildUserPrompt(workItem: RequirementAnalysisRequest["adoWorkItem"]): string {
  return `Analyze the following Azure DevOps work item and produce a requirement analysis:

${JSON.stringify(workItem, null, 2)}

Base your analysis on the title, description, and acceptance criteria. Identify any gaps or ambiguities in the requirements. Provide a quality score reflecting requirement clarity and completeness.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequirementAnalysisRequest;

    if (!body || !body.adoWorkItem) {
      return new Response(
        JSON.stringify({ error: "adoWorkItem (object) is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const llmApiKey = Deno.env.get("LLM_API_KEY");
    const llmBaseUrl = (Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");

    if (!llmApiKey) {
      return new Response(
        JSON.stringify({ error: "LLM_API_KEY secret is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userPrompt = buildUserPrompt(body.adoWorkItem);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    const { llmJson, usedModel, error } = await callLlm(llmApiKey, llmBaseUrl, messages, 0.3, 3000);
    if (error) {
      return new Response(
        JSON.stringify({ error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const content: string = (llmJson as Record<string, unknown>).choices?.[0] && typeof ((llmJson as Record<string, { message?: { content?: string } }>).choices[0]) === 'object'
      ? ((llmJson as Record<string, { message?: { content?: string } }[]>).choices[0] as { message?: { content?: string } })?.message?.content ?? ""
      : "";

    let analysis: unknown = null;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = { raw: content };
    }

    return new Response(
      JSON.stringify({
        sourceWorkItemId: body.adoWorkItem.id ?? null,
        analysis,
        llmUsage: llmJson.usage ?? null,
        model: usedModel,
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
