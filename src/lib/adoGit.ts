export type AdoRepoFile = {
  path: string;
  content: string;
};

export type AdoGitPublishResult = {
  success: boolean;
  created?: boolean;
  repoName?: string;
  repoId?: string;
  webUrl?: string;
  remoteUrl?: string;
  commitId?: string;
  files?: string[];
  error?: string;
};

const EMPTY_OBJECT_ID = '0000000000000000000000000000000000000000';

export function sanitizeAdoRepoName(name: string): string {
  return slugify(name).slice(0, 64) || 'aos-playwright';
}

export function defaultAdoRepoName(workItemId?: number | string | null, title?: string): string {
  const id = workItemId != null && String(workItemId).trim() ? String(workItemId).trim() : 'generated';
  const slug = slugify(title ?? '').slice(0, 32);
  const name = slug ? `aos-${slug}-wi-${id}` : `aos-playwright-wi-${id}`;
  return sanitizeAdoRepoName(name);
}

export function toGitPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function repoWebUrl(org: string, project: string, repoName: string, webUrl?: string): string {
  if (webUrl?.trim()) return webUrl.trim();
  return `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoName)}`;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  if (/TF401027|401|403|not authorized|access denied/i.test(`${res.status} ${text}`)) {
    return `ADO Git failed (${res.status}). The PAT needs Code (Read & Write). ${text}`.slice(0, 1200);
  }
  return `ADO Git failed (${res.status}): ${text}`.slice(0, 1200);
}

export async function upsertAdoGitRepo(opts: {
  org: string;
  project: string;
  apiVersion?: string;
  headers: Record<string, string>;
  repoName: string;
  files: AdoRepoFile[];
  commitMessage?: string;
}): Promise<AdoGitPublishResult> {
  const files = opts.files.filter((file) => file?.path && file.content != null);
  if (!files.length) {
    return { success: false, error: 'repoFiles are required' };
  }

  const apiVersion = opts.apiVersion || '7.0';
  const encodedProject = encodeURIComponent(opts.project);
  const safeName = sanitizeAdoRepoName(opts.repoName);
  const base = `https://dev.azure.com/${opts.org}/${encodedProject}/_apis/git/repositories`;
  const jsonHeaders = { ...opts.headers, 'Content-Type': 'application/json' };

  let created = false;
  let repo = await getRepo(`${base}/${encodeURIComponent(safeName)}?api-version=${apiVersion}`, opts.headers);
  if (!repo) {
    const createRes = await fetch(`${base}?api-version=${apiVersion}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: safeName, project: { name: opts.project } }),
    });
    if (!createRes.ok) {
      repo = await getRepo(`${base}/${encodeURIComponent(safeName)}?api-version=${apiVersion}`, opts.headers);
      if (!repo) {
        return { success: false, repoName: safeName, error: await readError(createRes) };
      }
    } else {
      created = true;
      repo = await createRes.json() as AdoRepoJson;
    }
  }

  const repoId = String(repo.id ?? safeName);
  const webUrl = repoWebUrl(opts.org, opts.project, repo.name ?? safeName, repo.webUrl);
  const refsRes = await fetch(`${base}/${encodeURIComponent(repoId)}/refs?filter=heads/&api-version=${apiVersion}`, {
    headers: opts.headers,
  });
  if (!refsRes.ok) {
    return { success: false, repoName: safeName, repoId, webUrl, error: await readError(refsRes) };
  }
  const refsJson = await refsRes.json() as { value?: { name?: string; objectId?: string }[] };
  const refs = Array.isArray(refsJson.value) ? refsJson.value : [];
  const main = refs.find((ref) => ref.name === 'refs/heads/main') ?? refs[0];
  const branch = main?.name || 'refs/heads/main';
  const oldObjectId = main?.objectId || EMPTY_OBJECT_ID;

  const changes: Array<Record<string, unknown>> = [];
  for (const file of files) {
    const path = toGitPath(file.path);
    let changeType = 'add';
    if (oldObjectId !== EMPTY_OBJECT_ID) {
      const itemRes = await fetch(
        `${base}/${encodeURIComponent(repoId)}/items?path=${encodeURIComponent(path)}&includeContent=true&api-version=${apiVersion}`,
        { headers: opts.headers },
      );
      if (itemRes.ok) {
        const item = await itemRes.json() as { content?: string };
        if (item.content === file.content) continue;
        changeType = 'edit';
      }
    }
    changes.push({
      changeType,
      item: { path },
      newContent: { content: file.content, contentType: 'rawtext' },
    });
  }

  if (!changes.length) {
    return {
      success: true,
      created,
      repoName: repo.name ?? safeName,
      repoId,
      webUrl,
      remoteUrl: repo.remoteUrl,
      files: files.map((file) => toGitPath(file.path)),
    };
  }

  const pushRes = await fetch(`${base}/${encodeURIComponent(repoId)}/pushes?api-version=${apiVersion}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      refUpdates: [{ name: branch, oldObjectId }],
      commits: [{
        comment: opts.commitMessage || 'Add generated Playwright spec',
        changes,
      }],
    }),
  });
  if (!pushRes.ok) {
    return { success: false, created, repoName: safeName, repoId, webUrl, error: await readError(pushRes) };
  }
  const pushed = await pushRes.json() as { commits?: { commitId?: string }[] };
  return {
    success: true,
    created,
    repoName: repo.name ?? safeName,
    repoId,
    webUrl,
    remoteUrl: repo.remoteUrl,
    commitId: pushed.commits?.[0]?.commitId,
    files: files.map((file) => toGitPath(file.path)),
  };
}

export async function linkWorkItemHyperlink(opts: {
  org: string;
  apiVersion?: string;
  headers: Record<string, string>;
  workItemId: number | string;
  url: string;
  comment?: string;
  existingUrls?: string[];
}): Promise<{ success: boolean; error?: string }> {
  if (opts.existingUrls?.some((url) => url === opts.url)) {
    return { success: true };
  }
  const apiVersion = opts.apiVersion || '7.0';
  const patchRes = await fetch(
    `https://dev.azure.com/${opts.org}/_apis/wit/workitems/${opts.workItemId}?api-version=${apiVersion}`,
    {
      method: 'PATCH',
      headers: { ...opts.headers, 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify([{
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Hyperlink',
          url: opts.url,
          attributes: { comment: opts.comment || 'Generated Playwright repository' },
        },
      }]),
    },
  );
  if (!patchRes.ok) {
    return { success: false, error: await readError(patchRes) };
  }
  return { success: true };
}

type AdoRepoJson = {
  id?: string;
  name?: string;
  webUrl?: string;
  remoteUrl?: string;
};

async function getRepo(url: string, headers: Record<string, string>): Promise<AdoRepoJson | null> {
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return await res.json() as AdoRepoJson;
}
