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

interface AgentProcessorRequest {
  agentType: string;
  upstreamData: Record<string, unknown>;
  workflowName?: string;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  "Test Data Generator":
    "You are a senior test data engineer. Given the upstream test cases, generate realistic test datasets for each scenario. Return ONLY valid JSON with a 'datasets' array. Each dataset has: scenarioId, data (object with field names and realistic values). Include positive, negative, and boundary data. Do not include markdown fences or commentary.",
  "Playwright Automation":
    "You are a senior Playwright automation engineer. Given the upstream test cases and/or test data, generate a complete Playwright test file in TypeScript. Return ONLY valid TypeScript code — no markdown fences, no commentary. Use @playwright/test imports, describe blocks, and page object patterns where appropriate.",
  "Code Review":
    "You are a senior code reviewer. Given the upstream Playwright automation code and/or test cases, perform a thorough code review. Return ONLY valid JSON with: score (number 0-10), issues (array of {severity: 'high'|'medium'|'low', message: string}), recommendation (string). Do not include markdown fences or commentary.",
  "Defect Analysis":
    "You are a senior QA engineer specializing in defect analysis. Given the upstream code review and/or test execution results, analyze potential defects. Return ONLY valid JSON with: defectTitle, severity ('critical'|'high'|'medium'|'low'), steps (array of strings), rootCause (string), recommendation (string). Do not include markdown fences or commentary.",
  "Report Generator":
    "You are a senior QA reporting specialist. Given all upstream workflow outputs, generate a comprehensive markdown test execution report. Include: executive summary, test coverage, results breakdown, defects found, quality assessment, and recommendations. Return ONLY markdown text — no JSON, no code fences around the entire output.",
};

function buildUserPrompt(agentType: string, upstreamData: Record<string, unknown>, workflowName?: string): string {
  const wfContext = workflowName ? ` for the workflow "${workflowName}"` : "";
  return `Process the following upstream data${wfContext} as a ${agentType} agent:

${JSON.stringify(upstreamData, null, 2)}

Analyze the data and produce your output according to your role.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as AgentProcessorRequest;

    if (!body || !body.agentType || !body.upstreamData) {
      return new Response(
        JSON.stringify({ error: "agentType and upstreamData are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = SYSTEM_PROMPTS[body.agentType];
    if (!systemPrompt) {
      return new Response(
        JSON.stringify({ error: `Unsupported agent type: ${body.agentType}` }),
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

    const userPrompt = buildUserPrompt(body.agentType, body.upstreamData, body.workflowName);
    const isCodeOutput = body.agentType === "Playwright Automation";
    const isMarkdownOutput = body.agentType === "Report Generator";
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const { llmJson, usedModel, error } = await callLlm(llmApiKey, llmBaseUrl, messages, 0.2, 4000);
    if (error) {
      return new Response(
        JSON.stringify({ error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const content: string = (llmJson as Record<string, unknown>).choices?.[0] && typeof ((llmJson as Record<string, { message?: { content?: string } }>).choices[0]) === 'object'
      ? ((llmJson as Record<string, { message?: { content?: string } }[]>).choices[0] as { message?: { content?: string } })?.message?.content ?? ""
      : "";

    let result: unknown = content;
    if (!isCodeOutput && !isMarkdownOutput) {
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();
        result = JSON.parse(cleaned);
      } catch {
        result = { raw: content };
      }
    } else if (isCodeOutput) {
      result = content.replace(/^```(?:typescript|ts)?\n?/g, "").replace(/```$/g, "").trim();
    }

    return new Response(
      JSON.stringify({
        agentType: body.agentType,
        result,
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
