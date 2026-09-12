import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { publishToAzureDevOps, type AdoAttachment, type AdoRepoFile, type AdoTestCase } from './server/ado-upload';

const DEFAULT_ORG = 'aiqenexus';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readPat(bodyPat?: string): string {
  if (bodyPat?.trim()) return bodyPat.trim();
  const file = resolve(process.cwd(), '.ado-pat');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  return '';
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function adoDevProxy(): Plugin {
  return {
    name: 'ado-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (req.method !== 'POST' || (path !== '/__studio/ado-retrieval' && path !== '/__studio/ado-upload')) {
          next();
          return;
        }
        try {
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          const adoPat = readPat(typeof body.adoPat === 'string' ? body.adoPat : undefined);

          if (path === '/__studio/ado-upload') {
            if (!adoPat) {
              json(res, 500, { error: 'Azure DevOps PAT is not configured for local upload' });
              return;
            }
            const result = await publishToAzureDevOps({
              testCases: Array.isArray(body.testCases) ? body.testCases as AdoTestCase[] : [],
              attachments: Array.isArray(body.attachments) ? body.attachments as AdoAttachment[] : [],
              repoFiles: Array.isArray(body.repoFiles) ? body.repoFiles as AdoRepoFile[] : [],
              adoRepoName: typeof body.adoRepoName === 'string' ? body.adoRepoName : undefined,
              sourceWorkItemId: body.sourceWorkItemId as number | string | undefined,
              adoOrg: typeof body.adoOrg === 'string' ? body.adoOrg : DEFAULT_ORG,
              adoProject: typeof body.adoProject === 'string' ? body.adoProject : undefined,
              adoApiVersion: typeof body.adoApiVersion === 'string' ? body.adoApiVersion : undefined,
              adoWorkItemType: typeof body.adoWorkItemType === 'string' ? body.adoWorkItemType : undefined,
              adoTags: typeof body.adoTags === 'string' ? body.adoTags : undefined,
              adoPat,
              linkToSource: body.linkToSource !== false,
            });
            json(res, result.status, result.body);
            return;
          }

          const workItemId = body.workItemId;
          const parsedId = typeof workItemId === 'number' ? workItemId : Number(workItemId);
          if (!workItemId || Number.isNaN(parsedId)) {
            json(res, 400, { error: 'workItemId (number) is required' });
            return;
          }
          const adoOrg = String(process.env.ADO_ORG || DEFAULT_ORG).trim();
          const apiVersion = String(body.adoApiVersion || '7.0').trim();
          if (!adoPat) {
            json(res, 500, { error: 'Azure DevOps PAT is not configured for local retrieval' });
            return;
          }
          const cleanOrg = adoOrg.replace(/[^a-zA-Z0-9_-]/g, '');
          const cleanId = parseInt(String(parsedId), 10);
          const adoUrl = `https://dev.azure.com/${cleanOrg}/_apis/wit/workitems/${cleanId}?api-version=${apiVersion}`;
          const auth = Buffer.from(`:${adoPat}`).toString('base64');
          const adoRes = await fetch(adoUrl, {
            headers: {
              Authorization: `Basic ${auth}`,
              Accept: 'application/json',
              'User-Agent': 'aos-studio-dev',
            },
          });
          if (!adoRes.ok) {
            const adoErr = await adoRes.text();
            json(res, 502, { error: `Azure DevOps request failed (${adoRes.status}): ${adoErr}`, requestUrl: adoUrl });
            return;
          }
          const workItem = await adoRes.json() as { id?: number; rev?: number; url?: string; fields?: Record<string, unknown> };
          const fields = workItem.fields ?? {};
          const assigned = fields['System.AssignedTo'];
          const normalized = {
            id: workItem.id ?? cleanId,
            title: fields['System.Title'] ?? null,
            description: fields['System.Description'] ?? null,
            state: fields['System.State'] ?? null,
            assignedTo: assigned && typeof assigned === 'object' && assigned !== null && 'displayName' in assigned
              ? (assigned as { displayName?: string }).displayName
              : null,
            workItemType: fields['System.WorkItemType'] ?? null,
            acceptanceCriteria: fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? null,
            tags: fields['System.Tags'] ? String(fields['System.Tags']).split(';').map((t) => t.trim()) : [],
            createdDate: fields['System.CreatedDate'] ?? null,
            changedDate: fields['System.ChangedDate'] ?? null,
            areaPath: fields['System.AreaPath'] ?? null,
            iterationPath: fields['System.IterationPath'] ?? null,
            priority: fields['Microsoft.VSTS.Common.Priority'] ?? null,
            boardColumn: fields['System.BoardColumn'] ?? null,
          };
          json(res, 200, {
            workItemId: cleanId,
            rawWorkItem: { id: workItem.id, rev: workItem.rev, url: workItem.url, fields },
            normalized,
            source: 'azure-devops',
            llmUsage: null,
          });
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : 'Unexpected error' });
        }
      });
    },
  };
}
