import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FALLBACK_MODEL = "gpt-4o-mini";

function isSafeModelId(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(value);
}

function resolveModel(envModel: string | undefined): string {
  if (!envModel) return FALLBACK_MODEL;
  if (isSafeModelId(envModel)) return envModel;
  return FALLBACK_MODEL;
}

async function callLlm(
  apiKey: string,
  baseUrl: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number,
  requestedModel?: string,
): Promise<{ llmJson: Record<string, unknown> | null; usedModel: string; error: string | null }> {
  const envModel = Deno.env.get("LLM_MODEL");
  const preferred = requestedModel && isSafeModelId(requestedModel)
    ? requestedModel
    : resolveModel(envModel);
  const models = [preferred];
  if (preferred !== FALLBACK_MODEL) models.push(FALLBACK_MODEL);

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
  displayName?: string;
  systemPrompt?: string;
  userPrompt?: string;
  outputInstructions?: string;
  outputFormat?: string;
  jsonSchema?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  modelName?: string;
  upstreamData: Record<string, unknown>;
  resolvedInputs?: Record<string, unknown>;
  workflowName?: string;
  workflowInput?: unknown;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  "Requirement Analysis":
    "You are a senior business analyst. Analyze the work item and return ONLY valid JSON with workItemId, title, businessObjective, acceptanceCriteria, qualityScore (0-100), and gaps (string array).",
  "Test Data Generator":
    "You are a senior test data engineer. Given the upstream test cases, generate realistic test datasets for each scenario. Return ONLY valid JSON with a 'datasets' array. Each dataset has: scenarioId, data (object with field names and realistic values). Include positive, negative, and boundary data. Do not include markdown fences or commentary.",
  "Playwright Automation":
    "You are a senior Playwright automation engineer. Given the upstream test cases and/or test data, generate a complete Playwright test file in TypeScript. Return ONLY valid TypeScript code — no markdown fences, no commentary. Use @playwright/test imports, describe blocks, and real locators against the provided base URL. For Parabank registration use /register.htm and unique usernames.",
  "Code Review":
    "You are a senior code reviewer. Given the upstream Playwright automation code and/or test cases, perform a thorough code review. Return ONLY valid JSON with: score (number 0-10), issues (array of {severity: 'high'|'medium'|'low', message: string}), recommendation (string). Do not include markdown fences or commentary.",
  "Defect Analysis":
    "You are a senior QA engineer specializing in defect analysis. Given the upstream code review and/or test execution results, analyze potential defects. Return ONLY valid JSON with: defectTitle, severity ('critical'|'high'|'medium'|'low'), steps (array of strings), rootCause (string), recommendation (string). Do not include markdown fences or commentary.",
  "Report Generator":
    "You are a senior QA reporting specialist. Given Playwright execute results and the rest of the workflow outputs, generate a comprehensive markdown test execution report. Include: executive summary, actual pass/fail counts and test titles, defects found, quality assessment, and recommendations. Do not write a report that only restates a condition expression. Return ONLY markdown text — no JSON, no code fences around the entire output.",
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

    if (!body || !body.agentType) {
      return new Response(
        JSON.stringify({ error: "agentType is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const upstreamData = body.upstreamData ?? {};
    const systemPrompt = (body.systemPrompt ?? "").trim()
      || SYSTEM_PROMPTS[body.agentType]
      || `You are ${body.displayName || body.agentType}, an expert agent. Follow the user instructions exactly. If JSON is requested, return ONLY valid JSON with no markdown fences.`;

    const llmApiKey = Deno.env.get("LLM_API_KEY");
    const llmBaseUrl = (Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");

    if (!llmApiKey) {
      return new Response(
        JSON.stringify({ error: "LLM_API_KEY secret is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let userPrompt = (body.userPrompt ?? "").trim();
    if (!userPrompt) {
      userPrompt = buildUserPrompt(body.agentType, upstreamData, body.workflowName);
      if (body.resolvedInputs && Object.keys(body.resolvedInputs).length) {
        userPrompt += `\n\nResolved node inputs:\n${JSON.stringify(body.resolvedInputs, null, 2)}`;
      }
    }
    if (body.outputInstructions) {
      userPrompt += `\n\nOutput instructions:\n${body.outputInstructions}`;
    }
    if (body.jsonSchema) {
      userPrompt += `\n\nOutput JSON schema:\n${body.jsonSchema}`;
    }

    const format = (body.outputFormat ?? "").toLowerCase();
    const isCodeOutput = body.agentType === "Playwright Automation" && format !== "json";
    const isMarkdownOutput = format === "markdown" || (body.agentType === "Report Generator" && format !== "json");
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const temperature = typeof body.temperature === "number" ? body.temperature : 0.2;
    const maxTokens = typeof body.maxTokens === "number" ? body.maxTokens : 4000;
    const { llmJson, usedModel, error } = await callLlm(llmApiKey, llmBaseUrl, messages, temperature, maxTokens, body.modelName);
    if (error || !llmJson) {
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
