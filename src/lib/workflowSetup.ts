import type { Agent, InputBinding, Workflow, WorkflowNode } from '@/types';
import { DEFAULT_PLAYWRIGHT_BASE_URL } from '@/lib/playwrightSpec';

export const USER_STORY_WORKFLOW_ID = 'w1';
export const DEFAULT_ADO_ORG = 'aiqenexus';
export const DEFAULT_ADO_PROJECT = 'AI_Agents';
export { DEFAULT_PLAYWRIGHT_BASE_URL };

export function applyDefaultAdoSettings(wf: Workflow): Workflow {
  let changed = false;
  const nodes = wf.nodes.map((node) => {
    const type = node.data.nodeType;
    const agentType = node.data.agentType;
    const isRetrieval = type === 'Data Retrieval' || agentType === 'Data Retrieval';
    const isUpload = type === 'ADO Upload' || agentType === 'ADO Upload'
      || type === 'azure-devops' || type === 'azure-devops-mcp';
    if (!isRetrieval && !isUpload) return node;
    const cfg = { ...(node.data.config as Record<string, unknown> | undefined) };
    let nodeChanged = false;
    if (!cfg.adoOrg) {
      cfg.adoOrg = DEFAULT_ADO_ORG;
      nodeChanged = true;
    }
    if (isUpload && !cfg.adoProject) {
      cfg.adoProject = DEFAULT_ADO_PROJECT;
      nodeChanged = true;
    }
    if (!nodeChanged) return node;
    changed = true;
    return { ...node, data: { ...node.data, config: cfg } };
  });
  return changed ? { ...wf, nodes, updatedAt: new Date().toISOString() } : wf;
}

export function applyDefaultPlaywrightSettings(wf: Workflow): Workflow {
  let changed = false;
  const nodes = wf.nodes.map((node) => {
    if (node.data.nodeType !== 'playwright-mcp') return node;
    const cfg = { ...(node.data.config as Record<string, unknown> | undefined) };
    let nodeChanged = false;
    if (!cfg.playwrightBaseUrl) {
      cfg.playwrightBaseUrl = DEFAULT_PLAYWRIGHT_BASE_URL;
      nodeChanged = true;
    }
    if (!cfg.playwrightAction) {
      const label = node.data.label.toLowerCase();
      cfg.playwrightAction = label.includes('execute') || label.includes('re-run') ? 'execute' : 'locators';
      nodeChanged = true;
    }
    if (!nodeChanged) return node;
    changed = true;
    return { ...node, data: { ...node.data, config: cfg } };
  });

  let next: Workflow = changed ? { ...wf, nodes, updatedAt: new Date().toISOString() } : wf;
  if (next.id === USER_STORY_WORKFLOW_ID && next.defaultInput) {
    try {
      const parsed = JSON.parse(next.defaultInput) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !parsed.baseUrl) {
        next = {
          ...next,
          defaultInput: JSON.stringify({ ...parsed, baseUrl: DEFAULT_PLAYWRIGHT_BASE_URL }),
          updatedAt: new Date().toISOString(),
        };
      }
    } catch {
      // keep the stored input
    }
  }
  return next;
}

export function applyStudioDefaults(wf: Workflow): Workflow {
  return applyDefaultPlaywrightSettings(applyDefaultAdoSettings(wf));
}

export function needsUserStoryUpgrade(wf: Workflow): boolean {
  if (wf.id !== USER_STORY_WORKFLOW_ID) return false;
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  if (!byId.has('n3') || !byId.has('n18')) return true;
  return wf.nodes.some((n) => (
    n.data.status === 'not-configured'
    || (n.data.kind === 'agent' && !n.data.agentId)
  ));
}

export function mergeUserStoryWorkflow(stored: Workflow, seed: Workflow): Workflow {
  if (!needsUserStoryUpgrade(stored)) return applyStudioDefaults(bindReadyAgents(stored));
  return applyStudioDefaults(bindReadyAgents({
    ...stored,
    description: seed.description,
    version: seed.version,
    defaultInput: stored.defaultInput || seed.defaultInput,
    nodes: seed.nodes,
    edges: seed.edges,
    updatedAt: new Date().toISOString(),
  }));
}

function defaultBindings(node: WorkflowNode, agents: Agent[]): InputBinding[] | undefined {
  const agent = node.data.agentId ? agents.find((a) => a.id === node.data.agentId) : undefined;
  if (!agent?.inputs?.length) return node.data.config && 'inputBindings' in (node.data.config as object)
    ? (node.data.config as { inputBindings?: InputBinding[] }).inputBindings
    : undefined;
  return agent.inputs.map((inp) => {
    const name = inp.name.toLowerCase();
    if (name.includes('workitem') || name === 'workitemid') {
      return { inputName: inp.name, source: 'workflow' as const, path: 'workItemId' };
    }
    return { inputName: inp.name, source: 'node' as const, path: 'output' };
  });
}

export function bindReadyAgents(wf: Workflow, agents: Agent[] = []): Workflow {
  return {
    ...wf,
    nodes: wf.nodes.map((node) => {
      if (node.data.kind !== 'agent') {
        if (node.data.status === 'not-configured') {
          return { ...node, data: { ...node.data, status: 'ready' } };
        }
        return node;
      }
      const agent = agents.find((a) => a.id === node.data.agentId)
        ?? agents.find((a) => a.type === node.data.nodeType || a.type === node.data.agentType);
      if (!agent) return node;
      const cfg = { ...(node.data.config ?? { timeoutSec: 60, retryCount: 2, loggingLevel: 'info' as const }) } as {
        timeoutSec: number;
        retryCount: number;
        loggingLevel: 'info' | 'debug' | 'warning' | 'error';
        inputBindings?: InputBinding[];
      };
      if (!cfg.inputBindings?.length) {
        const bindings = defaultBindings({ ...node, data: { ...node.data, agentId: agent.id } }, agents);
        if (bindings) cfg.inputBindings = bindings;
      }
      return {
        ...node,
        data: {
          ...node.data,
          agentId: agent.id,
          agentType: agent.type,
          icon: node.data.icon || agent.icon,
          status: 'ready',
          config: cfg,
        },
      };
    }),
  };
}
