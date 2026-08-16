import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const model = "gpt-4o-mini";
  const baseUrl = (Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const hasApiKey = !!Deno.env.get("LLM_API_KEY");

  let provider = "OpenAI";
  if (baseUrl.includes("azure.com") || baseUrl.includes("openai.azure.com")) provider = "Azure OpenAI";
  else if (baseUrl.includes("anthropic.com")) provider = "Anthropic";
  else if (baseUrl.includes("googleapis.com") || baseUrl.includes("gemini")) provider = "Google Gemini";
  else if (baseUrl.includes("ollama") || baseUrl.includes("localhost:11434")) provider = "Ollama";
  else if (baseUrl.includes("foundry")) provider = "Microsoft Foundry";

  return new Response(
    JSON.stringify({
      model,
      provider,
      baseUrl,
      configured: hasApiKey,
      status: hasApiKey ? "active" : "not-configured",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
