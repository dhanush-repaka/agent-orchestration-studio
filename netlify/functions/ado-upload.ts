import type { Handler } from '@netlify/functions';
import { publishToAzureDevOps, type AdoAttachment, type AdoRepoFile, type AdoTestCase } from '../../server/ado-upload';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST test cases or attachments' }) };
  }
  try {
    const body = event.body ? JSON.parse(event.body) as Record<string, unknown> : {};
    const result = await publishToAzureDevOps({
      testCases: Array.isArray(body.testCases) ? body.testCases as AdoTestCase[] : [],
      attachments: Array.isArray(body.attachments) ? body.attachments as AdoAttachment[] : [],
      repoFiles: Array.isArray(body.repoFiles) ? body.repoFiles as AdoRepoFile[] : [],
      adoRepoName: typeof body.adoRepoName === 'string' ? body.adoRepoName : undefined,
      sourceWorkItemId: body.sourceWorkItemId as number | string | undefined,
      adoOrg: typeof body.adoOrg === 'string' ? body.adoOrg : undefined,
      adoProject: typeof body.adoProject === 'string' ? body.adoProject : undefined,
      adoApiVersion: typeof body.adoApiVersion === 'string' ? body.adoApiVersion : undefined,
      adoWorkItemType: typeof body.adoWorkItemType === 'string' ? body.adoWorkItemType : undefined,
      adoTags: typeof body.adoTags === 'string' ? body.adoTags : undefined,
      adoPat: typeof body.adoPat === 'string' ? body.adoPat : process.env.ADO_PAT,
      linkToSource: body.linkToSource !== false,
    });
    return {
      statusCode: result.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(result.body),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err instanceof Error ? err.message : 'ADO upload failed' }),
    };
  }
};
