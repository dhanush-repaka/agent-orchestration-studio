import type { Agent, Credential, NodeRuntimeConfig, Workflow, WorkflowNode } from '@/types';

export type DeployAgentAction = 'create' | 'update' | 'reuse';

export interface DeployAgentStep {
  sourceId: string;
  sourceName: string;
  action: DeployAgentAction;
  targetId?: string;
}

export interface DeployCredentialStep {
  sourceId: string;
  sourceName: string;
  action: 'remap' | 'missing';
  targetId?: string;
}

export interface DeployGraphDiff {
  nodeCountChanged: boolean;
  sourceNodes: number;
  targetNodes: number;
  addedLabels: string[];
  removedLabels: string[];
}

export interface DeployPreview {
  sourceId: string;
  sourceName: string;
  sourceEnv: string;
  targetEnv: string;
  existingTargetId?: string;
  existingTargetName?: string;
  agents: DeployAgentStep[];
  missingAgentIds: string[];
  credentials: DeployCredentialStep[];
  diff?: DeployGraphDiff;
}

export interface DeployResult {
  workflow: Workflow;
  agents: Agent[];
  preview: DeployPreview;
}

export function boundAgentIds(workflow: Workflow): string[] {
  const ids = new Set<string>();
  for (const node of workflow.nodes) {
    const id = node.data.agentId;
    if (id) ids.add(id);
  }
  return [...ids];
}

export function findExistingDeployTarget(workflows: Workflow[], sourceId: string, targetEnv: string): Workflow | undefined {
  return workflows.find((w) => w.environment === targetEnv && w.sourceWorkflowId === sourceId);
}

export function matchTargetAgent(agents: Agent[], source: Agent, targetEnv: string): { agent: Agent; action: 'update' | 'reuse' } | undefined {
  const deployed = agents.find((a) => a.environment === targetEnv && a.sourceAgentId === source.id);
  if (deployed) return { agent: deployed, action: 'update' };
  const named = agents.find((a) => a.environment === targetEnv && a.name === source.name);
  if (named) return { agent: named, action: 'reuse' };
  return undefined;
}

export function boundCredentialIds(workflow: Workflow): string[] {
  const ids = new Set<string>();
  for (const node of workflow.nodes) {
    const cfg = node.data.config as NodeRuntimeConfig | undefined;
    if (cfg?.httpCredentialId) ids.add(cfg.httpCredentialId);
  }
  return [...ids];
}

export function matchTargetCredential(credentials: Credential[], source: Credential, targetEnv: string): Credential | undefined {
  return credentials.find((item) => item.environment === targetEnv && item.name === source.name);
}

export function deployGraphDiff(source: Workflow, target: Workflow): DeployGraphDiff {
  const sourceLabels = source.nodes.map((node) => node.data.label);
  const targetLabels = target.nodes.map((node) => node.data.label);
  const targetSet = new Set(targetLabels);
  const sourceSet = new Set(sourceLabels);
  return {
    nodeCountChanged: source.nodes.length !== target.nodes.length,
    sourceNodes: source.nodes.length,
    targetNodes: target.nodes.length,
    addedLabels: sourceLabels.filter((label) => !targetSet.has(label)),
    removedLabels: targetLabels.filter((label) => !sourceSet.has(label)),
  };
}

export function previewWorkflowDeploy(
  workflow: Workflow,
  agents: Agent[],
  workflows: Workflow[],
  targetEnv: string,
  credentials: Credential[] = [],
): DeployPreview {
  const existing = findExistingDeployTarget(workflows, workflow.id, targetEnv);
  const missingAgentIds: string[] = [];
  const steps: DeployAgentStep[] = [];

  for (const id of boundAgentIds(workflow)) {
    const source = agents.find((a) => a.id === id);
    if (!source) {
      missingAgentIds.push(id);
      continue;
    }
    const match = matchTargetAgent(agents, source, targetEnv);
    steps.push({
      sourceId: source.id,
      sourceName: source.displayName || source.name,
      action: match?.action ?? 'create',
      targetId: match?.agent.id,
    });
  }

  const credSteps: DeployCredentialStep[] = [];
  for (const id of boundCredentialIds(workflow)) {
    const source = credentials.find((item) => item.id === id);
    if (!source) {
      credSteps.push({ sourceId: id, sourceName: id, action: 'missing' });
      continue;
    }
    const match = matchTargetCredential(credentials, source, targetEnv);
    credSteps.push({
      sourceId: source.id,
      sourceName: source.name,
      action: match ? 'remap' : 'missing',
      targetId: match?.id,
    });
  }

  return {
    sourceId: workflow.id,
    sourceName: workflow.name,
    sourceEnv: workflow.environment,
    targetEnv,
    existingTargetId: existing?.id,
    existingTargetName: existing?.name,
    agents: steps,
    missingAgentIds,
    credentials: credSteps,
    diff: existing ? deployGraphDiff(workflow, existing) : undefined,
  };
}

function remapNodes(nodes: WorkflowNode[], agentRemap: Map<string, string>, credRemap: Map<string, string>): WorkflowNode[] {
  return nodes.map((node) => {
    const agentId = node.data.agentId;
    const cfg = node.data.config as NodeRuntimeConfig | undefined;
    const credId = cfg?.httpCredentialId;
    const nextCfg = credId && credRemap.has(credId)
      ? { ...cfg, httpCredentialId: credRemap.get(credId) }
      : cfg;
    return {
      ...node,
      data: {
        ...node.data,
        agentId: agentId ? (agentRemap.get(agentId) ?? agentId) : agentId,
        config: nextCfg,
      },
    };
  });
}

export function applyWorkflowDeploy(input: {
  workflow: Workflow;
  agents: Agent[];
  workflows: Workflow[];
  credentials?: Credential[];
  targetEnv: string;
  now: string;
  nextWorkflowId: string;
  allocateAgentId: () => string;
  webhookSecret: string;
}): DeployResult {
  const { workflow, agents, workflows, targetEnv, now, nextWorkflowId, allocateAgentId, webhookSecret } = input;
  const credentials = input.credentials ?? [];
  const preview = previewWorkflowDeploy(workflow, agents, workflows, targetEnv, credentials);
  const existing = findExistingDeployTarget(workflows, workflow.id, targetEnv);
  const remap = new Map<string, string>();
  const nextAgents: Agent[] = [];

  for (const step of preview.agents) {
    const source = agents.find((a) => a.id === step.sourceId);
    if (!source) continue;

    if (step.action === 'reuse' && step.targetId) {
      remap.set(source.id, step.targetId);
      continue;
    }

    if (step.action === 'update' && step.targetId) {
      const current = agents.find((a) => a.id === step.targetId);
      const updated: Agent = {
        ...source,
        id: step.targetId,
        environment: targetEnv,
        sourceAgentId: source.id,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        persisted: true,
      };
      remap.set(source.id, updated.id);
      nextAgents.push(updated);
      continue;
    }

    const created: Agent = {
      ...source,
      id: allocateAgentId(),
      environment: targetEnv,
      sourceAgentId: source.id,
      createdAt: now,
      updatedAt: now,
      persisted: true,
    };
    remap.set(source.id, created.id);
    nextAgents.push(created);
  }

  const credRemap = new Map<string, string>();
  for (const step of preview.credentials) {
    if (step.action === 'remap' && step.targetId) credRemap.set(step.sourceId, step.targetId);
  }

  const nextWorkflow: Workflow = {
    ...workflow,
    id: existing?.id ?? nextWorkflowId,
    environment: targetEnv,
    sourceWorkflowId: workflow.id,
    webhookSecret: existing?.webhookSecret ?? webhookSecret,
    lastScheduledAt: undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    nodes: remapNodes(workflow.nodes, remap, credRemap),
    edges: workflow.edges.map((edge) => ({ ...edge })),
  };

  return { workflow: nextWorkflow, agents: nextAgents, preview };
}
