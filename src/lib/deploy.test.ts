import { describe, expect, it } from 'vitest';
import { applyWorkflowDeploy, boundAgentIds, findExistingDeployTarget, matchTargetAgent, previewWorkflowDeploy } from '@/lib/deploy';
import type { Agent, Workflow, WorkflowNode } from '@/types';

const NOW = '2026-09-13T10:00:00.000Z';

function node(id: string, agentId?: string): WorkflowNode {
  return {
    id,
    type: 'studioNode',
    position: { x: 0, y: 0 },
    data: { kind: agentId ? 'agent' : 'control', nodeType: agentId ? 'agent' : 'start', label: id, status: 'ready', agentId },
  };
}

function agent(partial: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent {
  return {
    displayName: partial.displayName ?? partial.name,
    description: '',
    icon: 'Bot',
    type: 'Custom',
    category: 'General',
    tags: [],
    version: '1.0.0',
    owner: 'test',
    status: 'published',
    environment: 'development',
    modelProvider: 'OpenAI',
    modelName: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 100,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    timeoutSec: 30,
    retryCount: 0,
    prompt: { version: 1, systemPrompt: 'sys', userPromptTemplate: 'user', createdAt: NOW, createdBy: 'test' },
    promptHistory: [],
    inputs: [],
    output: { id: 'o1', format: 'json', requiredFields: [] },
    tools: [],
    knowledge: [],
    memory: { type: 'none' },
    guardrails: {},
    workflowsUsing: 0,
    createdAt: NOW,
    updatedAt: NOW,
    persisted: true,
    ...partial,
  };
}

function workflow(partial: Partial<Workflow> = {}): Workflow {
  return {
    id: 'w1',
    name: 'Invoice Flow',
    description: 'Source',
    category: 'General',
    owner: 'test',
    tags: [],
    version: '1.0.0',
    environment: 'development',
    triggerType: 'manual',
    defaultInput: '{}',
    maxExecutionTimeSec: 60,
    concurrencyLimit: 1,
    loggingLevel: 'info',
    failurePolicy: 'abort',
    nodes: [node('start'), node('a1', 'agent-1'), node('end')],
    edges: [
      { id: 'e1', source: 'start', target: 'a1' },
      { id: 'e2', source: 'a1', target: 'end' },
    ],
    published: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

describe('deploy', () => {
  it('collects bound agent ids and finds a previous deploy target', () => {
    const wf = workflow();
    expect(boundAgentIds(wf)).toEqual(['agent-1']);
    const copy = workflow({ id: 'w-qa', environment: 'qa', sourceWorkflowId: 'w1' });
    expect(findExistingDeployTarget([wf, copy], 'w1', 'qa')?.id).toBe('w-qa');
    expect(findExistingDeployTarget([wf, copy], 'w1', 'production')).toBeUndefined();
  });

  it('updates a previous agent copy and reuses a same-name agent', () => {
    const source = agent({ id: 'agent-1', name: 'planner' });
    const deployed = agent({ id: 'agent-qa', name: 'planner', environment: 'qa', sourceAgentId: 'agent-1' });
    const named = agent({ id: 'agent-named', name: 'planner', environment: 'uat' });
    expect(matchTargetAgent([deployed], source, 'qa')).toEqual({ agent: deployed, action: 'update' });
    expect(matchTargetAgent([named], source, 'uat')).toEqual({ agent: named, action: 'reuse' });
    expect(matchTargetAgent([], source, 'production')).toBeUndefined();
  });

  it('copies the workflow into the target env and remaps published agents', () => {
    const sourceAgent = agent({ id: 'agent-1', name: 'planner', displayName: 'Planner', prompt: { version: 1, systemPrompt: 'dev prompt', userPromptTemplate: 'user', createdAt: NOW, createdBy: 'test' } });
    const source = workflow();
    const result = applyWorkflowDeploy({
      workflow: source,
      agents: [sourceAgent],
      workflows: [source],
      targetEnv: 'qa',
      now: '2026-09-13T11:00:00.000Z',
      nextWorkflowId: 'w2',
      allocateAgentId: () => 'agent-2',
      webhookSecret: 'wh_new',
    });

    expect(result.workflow.id).toBe('w2');
    expect(result.workflow.environment).toBe('qa');
    expect(result.workflow.sourceWorkflowId).toBe('w1');
    expect(result.workflow.published).toBe(true);
    expect(result.workflow.nodes.find((n) => n.id === 'a1')?.data.agentId).toBe('agent-2');
    expect(source.environment).toBe('development');
    expect(source.nodes.find((n) => n.id === 'a1')?.data.agentId).toBe('agent-1');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]).toMatchObject({
      id: 'agent-2',
      environment: 'qa',
      sourceAgentId: 'agent-1',
      status: 'published',
      prompt: expect.objectContaining({ systemPrompt: 'dev prompt' }),
    });
    expect(result.preview.agents[0].action).toBe('create');
  });

  it('updates an existing deploy target and its previously copied agents', () => {
    const sourceAgent = agent({ id: 'agent-1', name: 'planner', displayName: 'Planner', prompt: { version: 2, systemPrompt: 'newer', userPromptTemplate: 'user', createdAt: NOW, createdBy: 'test' } });
    const qaAgent = agent({ id: 'agent-qa', name: 'planner', environment: 'qa', sourceAgentId: 'agent-1', prompt: { version: 1, systemPrompt: 'old', userPromptTemplate: 'user', createdAt: NOW, createdBy: 'test' } });
    const source = workflow({ version: '2.0.0' });
    const existing = workflow({
      id: 'w-qa',
      environment: 'qa',
      sourceWorkflowId: 'w1',
      webhookSecret: 'wh_keep',
      createdAt: '2026-09-01T00:00:00.000Z',
      nodes: [node('start'), node('a1', 'agent-qa'), node('end')],
    });

    const result = applyWorkflowDeploy({
      workflow: source,
      agents: [sourceAgent, qaAgent],
      workflows: [source, existing],
      targetEnv: 'qa',
      now: '2026-09-13T11:00:00.000Z',
      nextWorkflowId: 'w-should-not-use',
      allocateAgentId: () => 'unused',
      webhookSecret: 'wh_new',
    });

    expect(result.workflow.id).toBe('w-qa');
    expect(result.workflow.webhookSecret).toBe('wh_keep');
    expect(result.workflow.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(result.workflow.version).toBe('2.0.0');
    expect(result.workflow.nodes.find((n) => n.id === 'a1')?.data.agentId).toBe('agent-qa');
    expect(result.agents[0].prompt.systemPrompt).toBe('newer');
    expect(result.preview.existingTargetId).toBe('w-qa');
    expect(result.preview.agents[0].action).toBe('update');
  });

  it('reuses a same-name agent without overwriting it', () => {
    const sourceAgent = agent({ id: 'agent-1', name: 'planner', prompt: { version: 2, systemPrompt: 'dev', userPromptTemplate: 'user', createdAt: NOW, createdBy: 'test' } });
    const qaAgent = agent({ id: 'agent-hand', name: 'planner', environment: 'qa', prompt: { version: 1, systemPrompt: 'leave me', userPromptTemplate: 'user', createdAt: NOW, createdBy: 'test' } });
    const source = workflow();
    const preview = previewWorkflowDeploy(source, [sourceAgent, qaAgent], [source], 'qa');
    expect(preview.agents[0]).toMatchObject({ action: 'reuse', targetId: 'agent-hand' });

    const result = applyWorkflowDeploy({
      workflow: source,
      agents: [sourceAgent, qaAgent],
      workflows: [source],
      targetEnv: 'qa',
      now: NOW,
      nextWorkflowId: 'w2',
      allocateAgentId: () => 'unused',
      webhookSecret: 'wh_new',
    });
    expect(result.agents).toEqual([]);
    expect(result.workflow.nodes.find((n) => n.id === 'a1')?.data.agentId).toBe('agent-hand');
  });

  it('keeps missing agent bindings so the copy still shows the gap', () => {
    const source = workflow();
    const result = applyWorkflowDeploy({
      workflow: source,
      agents: [],
      workflows: [source],
      targetEnv: 'qa',
      now: NOW,
      nextWorkflowId: 'w2',
      allocateAgentId: () => 'unused',
      webhookSecret: 'wh_new',
    });
    expect(result.preview.missingAgentIds).toEqual(['agent-1']);
    expect(result.workflow.nodes.find((n) => n.id === 'a1')?.data.agentId).toBe('agent-1');
  });
});
