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
  return ensureCodeChangeLinked(applyDefaultPlaywrightSettings(applyDefaultAdoSettings(wf)));
}

export function codeChangeIsLinked(wf: Workflow): boolean {
  const hasCond = wf.nodes.some((n) => n.id === 'n9c' && n.data.nodeType === 'condition');
  const hasChange = wf.nodes.some((n) => n.id === 'n19');
  const reviewToCond = wf.edges.some((e) => e.source === 'n9' && e.target === 'n9c');
  const goodToExec = wf.edges.some((e) => e.source === 'n9c' && e.target === 'n10' && e.sourceHandle === 'out-true');
  const badToChange = wf.edges.some((e) => e.source === 'n9c' && e.target === 'n19' && e.sourceHandle === 'out-false');
  const changeToExec = wf.edges.some((e) => e.source === 'n19' && e.target === 'n10');
  const reviewToChange = wf.edges.some((e) => e.source === 'n9' && e.target === 'n19');
  const reviewToExec = wf.edges.some((e) => e.source === 'n9' && e.target === 'n10');
  return hasCond && hasChange && reviewToCond && goodToExec && badToChange && changeToExec && !reviewToChange && !reviewToExec;
}

export function ensureCodeChangeLinked(wf: Workflow): Workflow {
  if (wf.id !== USER_STORY_WORKFLOW_ID) return wf;
  if (codeChangeIsLinked(wf)) return wf;

  const review = wf.nodes.find((n) => n.id === 'n9');
  const exec = wf.nodes.find((n) => n.id === 'n10');
  if (!review || !exec) return wf;

  const condX = review.position.x + 220;
  const condY = review.position.y;
  const shift = exec.position.x < condX + 200 ? 220 : 0;
  const reviewOk: WorkflowNode = {
    id: 'n9c',
    type: 'studioNode',
    position: { x: condX, y: condY },
    data: {
      kind: 'control',
      nodeType: 'condition',
      label: 'Review OK?',
      status: 'ready',
      config: {
        timeoutSec: 15,
        retryCount: 0,
        loggingLevel: 'info',
        expression: '{{nodes.n9.reviewOk}}',
      },
    },
  };
  const codeChange: WorkflowNode = {
    id: 'n19',
    type: 'studioNode',
    position: { x: condX, y: condY + 220 },
    data: {
      kind: 'agent',
      nodeType: 'Code Change',
      label: 'Code Change',
      agentId: 'a11',
      agentType: 'Code Change',
      icon: 'Wrench',
      status: 'ready',
      config: {
        timeoutSec: 60,
        retryCount: 1,
        loggingLevel: 'info',
        inputBindings: [{ inputName: 'review', source: 'node', nodeId: 'n9', path: 'output' }],
      },
    },
  };

  const nodes = [
    ...wf.nodes.filter((n) => n.id !== 'n19' && n.id !== 'n9c').map((n) => (
      shift && n.position.x >= condX
        ? { ...n, position: { ...n.position, x: n.position.x + shift } }
        : n
    )),
    reviewOk,
    codeChange,
  ];
  const edges = [
    ...wf.edges.filter((e) => (
      e.source !== 'n9c' && e.target !== 'n9c'
      && e.source !== 'n19' && e.target !== 'n19'
      && !(e.source === 'n9' && e.target === 'n10')
    )),
    { id: 'e9c', source: 'n9', target: 'n9c', animated: false },
    { id: 'e9t', source: 'n9c', target: 'n10', label: 'good review', sourceHandle: 'out-true' },
    { id: 'e9f', source: 'n9c', target: 'n19', label: 'bad review', sourceHandle: 'out-false' },
    { id: 'e10', source: 'n19', target: 'n10', label: 'revised spec', animated: false },
  ];
  return { ...wf, nodes, edges, updatedAt: new Date().toISOString() };
}

export function needsUserStoryUpgrade(wf: Workflow): boolean {
  if (wf.id !== USER_STORY_WORKFLOW_ID) return false;
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  if (!byId.has('n3') || !byId.has('n18') || !codeChangeIsLinked(wf)) return true;
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
