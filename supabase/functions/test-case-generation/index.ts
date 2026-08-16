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

interface TestCaseGenerationRequest {
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
  "You are a senior QA architect. Using the normalized Azure DevOps work item produced by the ADO Work Item Retrieval Agent, reason step-by-step to design comprehensive test cases. Cover functional paths, boundary and edge cases, negative and error paths, and relevant non-functional concerns (performance, security, accessibility). For each test case, include a clear title, description, preconditions, the requirement it traces back to, priority, type, and expected outcome. Return ONLY valid JSON.";

function buildUserPrompt(workItem: TestCaseGenerationRequest["adoWorkItem"]): string {
  return `Generate test cases from the following normalized work item output produced by the upstream ADO Work Item Retrieval agent:

${JSON.stringify(workItem, null, 2)}

The work item contains: id, title, description, state, assignedTo, workItemType, acceptanceCriteria, tags, createdDate, changedDate. Use the acceptanceCriteria to drive test coverage. For each test case include: id, title, description, preconditions, requirementId (traceability to the source work item id), priority (critical/high/medium/low), type (functional/boundary/negative/non-functional), and expectedOutcome. Group test cases under a "testCases" array. Do not include markdown fences or commentary.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as TestCaseGenerationRequest;

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

    const { llmJson, usedModel, error } = await callLlm(llmApiKey, llmBaseUrl, messages, 0.2, 4000);
    if (error) {
      return new Response(
        JSON.stringify({ error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const content: string = llmJson.choices?.[0]?.message?.content ?? "";

    let testCases: unknown = null;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      testCases = JSON.parse(cleaned);
    } catch {
      testCases = { raw: content };
    }

    return new Response(
      JSON.stringify({
        sourceWorkItemId: body.adoWorkItem.id ?? null,
        testCases,
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
