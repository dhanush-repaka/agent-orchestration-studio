import { defaultAdoRepoName, linkWorkItemHyperlink, upsertAdoGitRepo, type AdoRepoFile } from '../src/lib/adoGit';

export type { AdoRepoFile };

export type AdoTestCase = {
  id?: string;
  title: string;
  description?: string;
  preconditions?: string[] | string;
  requirementId?: string;
  priority?: string;
  type?: string;
  expectedOutcome?: string;
};

export type AdoAttachment = {
  fileName: string;
  content: string;
  comment?: string;
};

const PRIORITY_MAP: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanOrg(raw: string): string {
  let value = raw.trim();
  if (value.includes('://')) {
    const urlParts = value.split('/');
    const afterDomain = urlParts.slice(3).filter(Boolean);
    value = afterDomain[0] ?? '';
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

export async function publishToAzureDevOps(body: {
  testCases?: AdoTestCase[];
  attachments?: AdoAttachment[];
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
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const adoOrg = cleanOrg(String(body.adoOrg || process.env.ADO_ORG || 'aiqenexus'));
  const apiVersion = String(body.adoApiVersion || '7.0');
  const workItemType = body.adoWorkItemType || 'Test Case';
  const tags = body.adoTags || 'AI-Orchestration-Agent';
  const linkToSource = body.linkToSource !== false;
  const adoPat = String(body.adoPat || '').trim();
  const testCases = Array.isArray(body.testCases) ? body.testCases : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter((a) => a?.fileName && a.content) : [];
  const repoFiles = Array.isArray(body.repoFiles) ? body.repoFiles.filter((file) => file?.path && file.content) : [];

  if (!adoPat) {
    return { status: 500, body: { error: 'Azure DevOps PAT is not configured' } };
  }
  if (!testCases.length && !attachments.length && !repoFiles.length) {
    return { status: 400, body: { error: 'testCases, attachments, or repoFiles are required' } };
  }

  const authHeaders = {
    Authorization: `Basic ${Buffer.from(`:${adoPat}`).toString('base64')}`,
    Accept: 'application/json',
    'User-Agent': 'aos-studio',
  };

  let projectName = (body.adoProject && String(body.adoProject).trim()) || '';
  let sourceWorkItemUrl = '';
  let sourceTitle = '';
  const existingLinks: string[] = [];
  if (body.sourceWorkItemId) {
    const wiRes = await fetch(`https://dev.azure.com/${adoOrg}/_apis/wit/workitems/${body.sourceWorkItemId}?$expand=relations&api-version=${apiVersion}`, {
      headers: authHeaders,
    });
    if (wiRes.ok) {
      const wiJson = await wiRes.json() as {
        url?: string;
        fields?: Record<string, string>;
        relations?: { url?: string }[];
      };
      const areaPath = wiJson.fields?.['System.AreaPath'] ?? '';
      if (areaPath) projectName = areaPath.split('\\')[0] ?? projectName;
      sourceWorkItemUrl = wiJson.url ?? '';
      sourceTitle = String(wiJson.fields?.['System.Title'] ?? '');
      for (const rel of wiJson.relations ?? []) {
        if (rel.url) existingLinks.push(rel.url);
      }
    }
  }
  if (!projectName) {
    return { status: 400, body: { error: 'Could not determine the ADO project name from the source work item.' } };
  }

  const encodedProject = encodeURIComponent(projectName);
  const results: Array<{ title: string; success: boolean; workItemId?: number; url?: string; error?: string }> = [];

  for (const tc of testCases) {
    const title = tc.title ?? 'Untitled Test Case';
    const description = tc.description ?? '';
    const preconditionsRaw = tc.preconditions;
    const preconditions = Array.isArray(preconditionsRaw)
      ? preconditionsRaw.join('\n- ')
      : (typeof preconditionsRaw === 'string' ? preconditionsRaw : '');
    const expectedOutcome = tc.expectedOutcome ?? '';
    const fullDescription = preconditions ? `${description}\n\nPreconditions:\n- ${preconditions}` : description;
    const stepsXml = `<steps><step id="1" type="ActionStep"><description>${escapeXml(description)}</description><expectedResult>${escapeXml(expectedOutcome)}</expectedResult></step></steps>`;
    const document: Array<Record<string, unknown>> = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: PRIORITY_MAP[tc.priority ?? 'medium'] ?? 3 },
      { op: 'add', path: '/fields/System.Description', value: fullDescription },
      { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: stepsXml },
      { op: 'add', path: '/fields/System.Tags', value: tags },
    ];
    if (linkToSource && sourceWorkItemUrl) {
      document.push({
        op: 'add',
        path: '/relations/-',
        value: { rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: sourceWorkItemUrl, attributes: { name: 'Tested By' } },
      });
    }
    const createUrl = `https://dev.azure.com/${adoOrg}/${encodedProject}/_apis/wit/workitems/$${encodeURIComponent(workItemType.replace(/^\$/, ''))}?api-version=${apiVersion}`;
    try {
      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json-patch+json' },
        body: JSON.stringify(document),
      });
      if (createRes.ok) {
        const created = await createRes.json() as { id?: number; url?: string };
        results.push({ title, success: true, workItemId: created.id, url: created.url });
      } else {
        const detail = await createRes.text();
        results.push({ title, success: false, error: `ADO create failed (${createRes.status}): ${detail}` });
        if (createRes.status === 401 || /personal access token[^\n]{0,80}expired|tf401349/i.test(detail)) {
          for (const remaining of testCases.slice(results.length)) {
            results.push({
              title: remaining.title ?? 'Untitled Test Case',
              success: false,
              error: 'Skipped: Azure DevOps PAT is expired or unauthorized',
            });
          }
          break;
        }
      }
    } catch (err) {
      results.push({ title, success: false, error: err instanceof Error ? err.message : 'Network error' });
    }
  }

  const uploadedAttachments: Array<{ fileName: string; success: boolean; url?: string; error?: string }> = [];
  if (body.sourceWorkItemId && attachments.length) {
    for (const file of attachments) {
      try {
        const attachRes = await fetch(
          `https://dev.azure.com/${adoOrg}/${encodedProject}/_apis/wit/attachments?fileName=${encodeURIComponent(file.fileName)}&api-version=${apiVersion}`,
          {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/octet-stream' },
            body: file.content,
          },
        );
        if (!attachRes.ok) {
          uploadedAttachments.push({ fileName: file.fileName, success: false, error: `upload failed (${attachRes.status}): ${await attachRes.text()}` });
          continue;
        }
        const uploaded = await attachRes.json() as { url?: string };
        const patchRes = await fetch(
          `https://dev.azure.com/${adoOrg}/_apis/wit/workitems/${body.sourceWorkItemId}?api-version=${apiVersion}`,
          {
            method: 'PATCH',
            headers: { ...authHeaders, 'Content-Type': 'application/json-patch+json' },
            body: JSON.stringify([{
              op: 'add',
              path: '/relations/-',
              value: {
                rel: 'AttachedFile',
                url: uploaded.url,
                attributes: { comment: file.comment || file.fileName },
              },
            }]),
          },
        );
        if (!patchRes.ok) {
          uploadedAttachments.push({ fileName: file.fileName, success: false, error: `link failed (${patchRes.status}): ${await patchRes.text()}` });
          continue;
        }
        uploadedAttachments.push({ fileName: file.fileName, success: true, url: uploaded.url });
      } catch (err) {
        uploadedAttachments.push({
          fileName: file.fileName,
          success: false,
          error: err instanceof Error ? err.message : 'Network error',
        });
      }
    }
  }

  let repository: Record<string, unknown> | null = null;
  if (repoFiles.length) {
    const repoName = (body.adoRepoName && String(body.adoRepoName).trim())
      || defaultAdoRepoName(body.sourceWorkItemId, sourceTitle);
    const published = await upsertAdoGitRepo({
      org: adoOrg,
      project: projectName,
      apiVersion,
      headers: authHeaders,
      repoName,
      files: repoFiles,
      commitMessage: body.sourceWorkItemId
        ? `Add generated Playwright spec for work item ${body.sourceWorkItemId}`
        : 'Add generated Playwright spec',
    });
    if (published.success && published.webUrl && body.sourceWorkItemId) {
      const linked = await linkWorkItemHyperlink({
        org: adoOrg,
        apiVersion,
        headers: authHeaders,
        workItemId: body.sourceWorkItemId,
        url: published.webUrl,
        comment: 'Generated Playwright repository',
        existingUrls: existingLinks,
      });
      repository = { ...published, workItemLinked: linked.success, linkError: linked.error };
    } else {
      repository = published;
    }
  }

  return {
    status: 200,
    body: {
      sourceWorkItemId: body.sourceWorkItemId ?? null,
      projectName,
      totalTestCases: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
      attachments: uploadedAttachments,
      attached: uploadedAttachments.filter((a) => a.success).length,
      repository,
    },
  };
}
