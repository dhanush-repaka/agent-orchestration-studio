import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const CREDENTIAL_LOOKUP_MS = 2500;

export async function resolveAdoPat(
  supabase: SupabaseClient,
  incomingPat?: string,
): Promise<{ pat: string; error?: string }> {
  const fromBody = incomingPat?.trim() ?? "";
  if (fromBody) return { pat: fromBody };

  const fromEnv = (Deno.env.get("ADO_PAT") ?? "").trim();
  if (fromEnv) return { pat: fromEnv };

  try {
    const lookup = supabase
      .from("credentials")
      .select("value")
      .eq("name", "Azure DevOps PAT")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const timed = new Promise<{ data: { value?: string } | null; error: { message: string } }>((resolve) => {
      setTimeout(() => resolve({ data: null, error: { message: "credential lookup timed out" } }), CREDENTIAL_LOOKUP_MS);
    });
    const { data, error } = await Promise.race([lookup, timed]);
    const value = typeof data?.value === "string" ? data.value.trim() : "";
    if (value) return { pat: value };
    if (error) {
      console.error("ADO credential read failed", error);
      return { pat: "", error: "Could not load the Azure DevOps credential" };
    }
    return { pat: "", error: "Azure DevOps PAT not found in credentials table. Please add it in the Credentials page." };
  } catch (err) {
    console.error("ADO credential read failed", err);
    return { pat: "", error: "Could not load the Azure DevOps credential" };
  }
}
