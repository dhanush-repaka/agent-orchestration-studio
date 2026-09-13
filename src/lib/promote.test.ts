import { describe, expect, it } from 'vitest';
import { evaluationReady, latestRunForWorkflow, promoteBlockers } from '@/lib/promote';
import type { Agent, Evaluation, Workflow, WorkflowNode, WorkflowRun } from '@/types';

function node(id: string, agentId?: string): WorkflowNode {
  return {
    id,
    type: 'studioNode',
    position: { x: 0, y: 0 },
    data: { kind: agentId ? 'agent' : 'control', nodeType: agentId ? 'agent' : 'start', label: id, status: 'ready', agentId },
  };
}

function workflow(): Workflow {
  return {
    id: 'w1',
    name: 'Flow',
    description: '',
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
    edges: [],
    published: true,
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:00:00.000Z',
  };
}

function run(partial: Partial<WorkflowRun> & Pick<WorkflowRun, 'id' | 'status' | 'startTime'>): WorkflowRun {
  return {
    workflowId: 'w1',
    workflowName: 'Flow',
    workflowVersion: '1.0.0',
    triggeredBy: 'qa',
    environment: 'development',
    totalTokens: 0,
    estimatedCost: 0,
    nodeExecutions: [],
    logs: [],
    ...partial,
  };
}

function evaluation(partial: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'e1',
    name: 'Eval',
    agentId: 'agent-1',
    agentName: 'Writer',
    status: 'completed',
    cases: [{ id: 'c1', input: 'in', expectedOutput: 'out' }],
    createdAt: '2026-09-13T10:00:00.000Z',
    averageAccuracy: 0.9,
    ...partial,
  };
}

const agent = {
  id: 'agent-1',
  displayName: 'Writer',
} as Agent;

describe('promote', () => {
  it('picks the newest run for a workflow', () => {
    const latest = latestRunForWorkflow([
      run({ id: 'old', status: 'failed', startTime: '2026-09-12T10:00:00.000Z' }),
      run({ id: 'new', status: 'completed', startTime: '2026-09-13T10:00:00.000Z' }),
    ], 'w1');
    expect(latest?.id).toBe('new');
  });

  it('treats empty or approved evaluations as ready', () => {
    expect(evaluationReady(evaluation({ cases: [] }))).toBe(true);
    expect(evaluationReady(evaluation({ approvedForProduction: true, averageAccuracy: 0.1, status: 'draft' }))).toBe(true);
    expect(evaluationReady(evaluation({ averageAccuracy: 0.4 }))).toBe(false);
    expect(evaluationReady(evaluation({ averageAccuracy: 0.7 }))).toBe(true);
  });

  it('blocks deploy until the latest run succeeds and bound evals pass', () => {
    const wf = workflow();
    expect(promoteBlockers(wf, [], [], [agent])).toEqual(['Run this workflow successfully before deploying it']);
    expect(promoteBlockers(wf, [run({ id: 'r1', status: 'failed', startTime: '2026-09-13T10:00:00.000Z' })], [], [agent])[0])
      .toContain('did not succeed');
    expect(promoteBlockers(wf, [run({ id: 'r1', status: 'waiting-approval', startTime: '2026-09-13T10:00:00.000Z' })], [], [agent])[0])
      .toContain('finish');
    expect(promoteBlockers(
      wf,
      [run({ id: 'r1', status: 'completed', startTime: '2026-09-13T10:00:00.000Z' })],
      [evaluation({ averageAccuracy: 0.2 })],
      [agent],
    )[0]).toContain('Writer');
    expect(promoteBlockers(
      wf,
      [run({ id: 'r1', status: 'completed', startTime: '2026-09-13T10:00:00.000Z' })],
      [evaluation({ averageAccuracy: 0.8 })],
      [agent],
    )).toEqual([]);
  });
});
