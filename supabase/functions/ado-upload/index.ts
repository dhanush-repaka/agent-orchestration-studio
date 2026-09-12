import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { defaultAdoRepoName, linkWorkItemHyperlink, upsertAdoGitRepo, type AdoRepoFile } from "../_shared/adoGit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface UploadRequest {
  testCases?: Array<{
    id?: string;
    title: string;
    description?: string;
    preconditions?: string[] | string;
    requirementId?: string;
    priority?: string;
    type?: string;
    expectedOutcome?: string;
  }>;
  attachments?: Array<{
    fileName: string;
    content: string;
    comment?: string;
  }>;
  repoFiles?: AdoRepoFile[];
  adoRepoName?: string;
  sourceWorkItemId?: number | string;
  adoOrg?: string;
  adoProject?: string;
  adoApiVersion?: string;
  adoWorkItemType?: string;
  adoTags?: string;
  adoPat?: string;
  linkToSource?: boolean;
  priorityMap?: Record<string, number>;
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

    const testCases = Array.isArray(body?.testCases) ? body.testCases : [];
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments.filter((file) => file?.fileName && file.content)
      : [];
    const repoFiles = Array.isArray(body?.repoFiles)
      ? body.repoFiles.filter((file) => file?.path && file.content)
      : [];

    if (!testCases.length && !attachments.length && !repoFiles.length) {
      return new Response(
        JSON.stringify({ error: "testCases, attachments, or repoFiles are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adoOrg = (body.adoOrg && String(body.adoOrg).trim()) || Deno.env.get("ADO_ORG") || "aiqenexus";
    const apiVersion = (body.adoApiVersion && String(body.adoApiVersion).trim()) || Deno.env.get("ADO_API_VERSION") || "7.0";
    const workItemType = body.adoWorkItemType || "Test Case";
    const tags = body.adoTags || "AI-Orchestration-Agent";
    const linkToSource = body.linkToSource !== false;
    const priorityMap = { ...PRIORITY_MAP, ...(body.priorityMap ?? {}) };

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

    const incomingPat = typeof body.adoPat === "string" ? body.adoPat.trim() : "";
    const adoPat = incomingPat || credRow?.value || Deno.env.get("ADO_PAT") || "";

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
    let projectName = (body.adoProject && String(body.adoProject).trim()) || "";
    let sourceWorkItemUrl = "";
    let sourceTitle = "";
    const existingLinks: string[] = [];
    if (body.sourceWorkItemId) {
      const wiUrl = `https://dev.azure.com/${cleanOrg}/_apis/wit/workitems/${body.sourceWorkItemId}?$expand=relations&api-version=${apiVersion}`;
      const wiRes = await fetch(wiUrl, { headers: authHeaders });
      if (wiRes.ok) {
        const wiJson = await wiRes.json();
        const areaPath: string = wiJson.fields?.["System.AreaPath"] ?? "";
        if (areaPath) {
          projectName = areaPath.split("\\")[0] ?? "";
        }
        sourceWorkItemUrl = wiJson.url ?? "";
        sourceTitle = String(wiJson.fields?.["System.Title"] ?? "");
        for (const rel of wiJson.relations ?? []) {
          if (rel.url) existingLinks.push(rel.url);
        }
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

    for (const tc of testCases) {
      const title = tc.title ?? "Untitled Test Case";
      const description = tc.description ?? "";
      const preconditionsRaw = tc.preconditions;
      const preconditions = Array.isArray(preconditionsRaw)
        ? preconditionsRaw.join("\n- ")
        : (typeof preconditionsRaw === "string" ? preconditionsRaw : "");
      const priorityVal = priorityMap[tc.priority ?? "medium"] ?? 3;
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
        { op: "add", path: "/fields/System.Tags", value: tags },
      ];

      if (linkToSource && body.sourceWorkItemId && sourceWorkItemUrl) {
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

      const encodedType = encodeURIComponent(workItemType.replace(/^\$/, ""));
      const createUrl = `https://dev.azure.com/${cleanOrg}/${encodedProject}/_apis/wit/workitems/$${encodedType}?api-version=${apiVersion}`;

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
          if (createRes.status === 401 || /personal access token[^\n]{0,80}expired|tf401349/i.test(errText)) {
            for (const remaining of testCases.slice(results.length)) {
              results.push({
                title: remaining.title ?? "Untitled Test Case",
                success: false,
                error: "Skipped: Azure DevOps PAT is expired or unauthorized",
              });
            }
            break;
          }
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
    const uploadedAttachments: Array<{ fileName: string; success: boolean; url?: string; error?: string }> = [];

    if (body.sourceWorkItemId && attachments.length) {
      for (const file of attachments) {
        try {
          const attachRes = await fetch(
            `https://dev.azure.com/${cleanOrg}/${encodedProject}/_apis/wit/attachments?fileName=${encodeURIComponent(file.fileName)}&api-version=${apiVersion}`,
            {
              method: "POST",
              headers: {
                ...authHeaders,
                "Content-Type": "application/octet-stream",
              },
              body: file.content,
            },
          );
          if (!attachRes.ok) {
            uploadedAttachments.push({
              fileName: file.fileName,
              success: false,
              error: `upload failed (${attachRes.status}): ${await attachRes.text()}`,
            });
            continue;
          }
          const uploaded = await attachRes.json();
          const patchRes = await fetch(
            `https://dev.azure.com/${cleanOrg}/_apis/wit/workitems/${body.sourceWorkItemId}?api-version=${apiVersion}`,
            {
              method: "PATCH",
              headers: {
                ...authHeaders,
                "Content-Type": "application/json-patch+json",
              },
              body: JSON.stringify([{
                op: "add",
                path: "/relations/-",
                value: {
                  rel: "AttachedFile",
                  url: uploaded.url,
                  attributes: { comment: file.comment || file.fileName },
                },
              }]),
            },
          );
          if (!patchRes.ok) {
            uploadedAttachments.push({
              fileName: file.fileName,
              success: false,
              error: `link failed (${patchRes.status}): ${await patchRes.text()}`,
            });
            continue;
          }
          uploadedAttachments.push({ fileName: file.fileName, success: true, url: uploaded.url });
        } catch (err) {
          uploadedAttachments.push({
            fileName: file.fileName,
            success: false,
            error: err instanceof Error ? err.message : "Network error",
          });
        }
      }
    }

    let repository: Record<string, unknown> | null = null;
    if (repoFiles.length) {
      const repoName = (body.adoRepoName && String(body.adoRepoName).trim())
        || defaultAdoRepoName(body.sourceWorkItemId, sourceTitle);
      const published = await upsertAdoGitRepo({
        org: cleanOrg,
        project: projectName,
        apiVersion,
        headers: authHeaders,
        repoName,
        files: repoFiles,
        commitMessage: body.sourceWorkItemId
          ? `Add generated Playwright spec for work item ${body.sourceWorkItemId}`
          : "Add generated Playwright spec",
      });
      if (published.success && published.webUrl && body.sourceWorkItemId) {
        const linked = await linkWorkItemHyperlink({
          org: cleanOrg,
          apiVersion,
          headers: authHeaders,
          workItemId: body.sourceWorkItemId,
          url: published.webUrl,
          comment: "Generated Playwright repository",
          existingUrls: existingLinks,
        });
        repository = { ...published, workItemLinked: linked.success, linkError: linked.error };
      } else {
        repository = published;
      }
    }

    return new Response(
      JSON.stringify({
        sourceWorkItemId: body.sourceWorkItemId ?? null,
        projectName,
        totalTestCases: results.length,
        succeeded,
        failed,
        results,
        attachments: uploadedAttachments,
        attached: uploadedAttachments.filter((a) => a.success).length,
        repository,
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
