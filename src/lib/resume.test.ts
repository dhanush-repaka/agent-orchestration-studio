import { describe, expect, it } from 'vitest';
import { nextResumeNode, orphanedRunningRun, resumeSeedForOrphan } from '@/lib/resume';
import type { NodeExecution, Workflow, WorkflowNode, WorkflowRun } from '@/types';

function node(id: string, nodeType = 'transform'): WorkflowNode {
  return {
    id,
    type: 'studioNode',
    position: { x: 0, y: 0 },
    data: { kind: 'control', nodeType, label: id, status: 'ready' },
  };
}

const workflow: Workflow = {
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
  nodes: [node('start', 'start'), node('mid'), node('end', 'end')],
  edges: [
    { id: 'e1', source: 'start', target: 'mid' },
    { id: 'e2', source: 'mid', target: 'end' },
  ],
  published: true,
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

function exec(nodeId: string, status: NodeExecution['status'], output?: string): NodeExecution {
  return {
    nodeId,
    nodeLabel: nodeId,
    status,
    output,
    tokenUsage: 0,
    cost: 0,
    executionTimeMs: 1,
    retryCount: 0,
    startedAt: '2026-09-13T10:00:00.000Z',
  };
}

function run(partial: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'r1',
    workflowId: 'w1',
    workflowName: 'Flow',
    workflowVersion: '1.0.0',
    status: 'running',
    triggeredBy: 'qa',
    environment: 'development',
    startTime: '2026-09-13T10:00:00.000Z',
    totalTokens: 0,
    estimatedCost: 0,
    nodeExecutions: [],
    logs: [],
    ...partial,
  };
}

describe('resume', () => {
  it('resumes from the start when nothing completed', () => {
    expect(nextResumeNode(run(), workflow)).toBe('start');
  });

  it('resumes the next unfinished successor', () => {
    const interrupted = run({
      nodeExecutions: [exec('start', 'completed', '{"ok":true}')],
    });
    expect(nextResumeNode(interrupted, workflow)).toBe('mid');
    expect(resumeSeedForOrphan(interrupted, workflow)?.fromNodeId).toBe('mid');
  });

  it('finds an orphaned running run that is not the live one', () => {
    const live = run({ id: 'live' });
    const orphan = run({ id: 'orphan' });
    expect(orphanedRunningRun([live, orphan], 'live')?.id).toBe('orphan');
    expect(orphanedRunningRun([live], 'live')).toBeUndefined();
  });
});
