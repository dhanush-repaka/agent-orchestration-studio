import { describe, expect, it } from 'vitest';
import { compareRuns, isServerTriggered, siblingRuns } from '@/lib/compareRuns';
import type { NodeExecution, WorkflowRun } from '@/types';

function exec(nodeId: string, output: string, status: NodeExecution['status'] = 'completed'): NodeExecution {
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

function run(partial: Partial<WorkflowRun> & Pick<WorkflowRun, 'id'>): WorkflowRun {
  return {
    workflowId: 'w1',
    workflowName: 'Invoice Flow',
    workflowVersion: '1.0.0',
    status: 'completed',
    triggeredBy: 'qa',
    environment: 'qa',
    startTime: '2026-09-13T10:00:00.000Z',
    totalTokens: 0,
    estimatedCost: 0,
    nodeExecutions: [],
    logs: [],
    ...partial,
  };
}

describe('compareRuns', () => {
  it('aligns nodes and reports output mismatches', () => {
    const left = run({
      id: 'r1',
      environment: 'qa',
      nodeExecutions: [exec('start', '{"ok":true}'), exec('mid', 'qa')],
    });
    const right = run({
      id: 'r2',
      environment: 'production',
      status: 'failed',
      nodeExecutions: [exec('start', '{"ok":true}'), exec('mid', 'prod')],
    });
    const result = compareRuns(left, right);
    expect(result.sameWorkflow).toBe(true);
    expect(result.sameStatus).toBe(false);
    expect(result.nodes.find((n) => n.nodeId === 'start')?.match).toBe(true);
    expect(result.nodes.find((n) => n.nodeId === 'mid')?.match).toBe(false);
  });

  it('finds siblings by workflow name and flags server triggers', () => {
    const left = run({ id: 'r1' });
    const peers = siblingRuns(left, [
      left,
      run({ id: 'r2', environment: 'production' }),
      run({ id: 'other', workflowName: 'Other' }),
    ]);
    expect(peers.map((item) => item.id)).toEqual(['r2']);
    expect(isServerTriggered('schedule')).toBe(true);
    expect(isServerTriggered('webhook')).toBe(true);
    expect(isServerTriggered('Priya Sharma')).toBe(false);
  });
});
