import { describe, expect, it } from 'vitest';
import { computeMonitoringStats, formatDuration, formatPct } from '@/lib/monitoring';
import type { NodeExecution, WorkflowRun } from '@/types';

function run(partial: Partial<WorkflowRun> & Pick<WorkflowRun, 'id' | 'status'>): WorkflowRun {
  return {
    workflowId: 'w1',
    workflowName: 'Main',
    workflowVersion: '1.0.0',
    triggeredBy: 'qa',
    environment: 'production',
    startTime: '2025-07-22T10:00:00Z',
    totalTokens: 0,
    estimatedCost: 0,
    nodeExecutions: [],
    logs: [],
    ...partial,
  };
}

function node(partial: Partial<NodeExecution> & Pick<NodeExecution, 'nodeId' | 'nodeLabel' | 'status'>): NodeExecution {
  return {
    tokenUsage: 0,
    cost: 0,
    executionTimeMs: 0,
    retryCount: 0,
    startedAt: '2025-07-22T10:00:00Z',
    ...partial,
  };
}

describe('computeMonitoringStats', () => {
  it('returns zeros for an empty history', () => {
    const stats = computeMonitoringStats([]);
    expect(stats.workflowSuccessRate).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.costByWorkflow).toEqual([]);
  });

  it('derives success, duration, and cost from runs', () => {
    const stats = computeMonitoringStats([
      run({ id: 'r1', status: 'completed', durationMs: 100_000, totalTokens: 1000, estimatedCost: 0.40, workflowName: 'A' }),
      run({ id: 'r2', status: 'failed', durationMs: 50_000, totalTokens: 500, estimatedCost: 0.10, workflowName: 'A' }),
      run({ id: 'r3', status: 'completed', durationMs: 20_000, totalTokens: 100, estimatedCost: 0.05, workflowName: 'B' }),
    ]);
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.workflowSuccessRate).toBeCloseTo(66.666, 2);
    expect(stats.avgDurationMs).toBeCloseTo(56_666.6, 0);
    expect(stats.p95DurationMs).toBe(100_000);
    expect(stats.totalTokens).toBe(1600);
    expect(stats.totalCost).toBeCloseTo(0.55);
    expect(stats.costByWorkflow[0]).toEqual({ name: 'A', cost: 0.5 });
  });

  it('scores agent nodes, tool failures, retries, and approval waits', () => {
    const stats = computeMonitoringStats([
      run({
        id: 'r1',
        status: 'completed',
        nodeExecutions: [
          node({ nodeId: 'n1', nodeLabel: 'Retrieve', agentName: 'Retriever', status: 'completed', cost: 0.02, toolCalls: [{ tool: 'ado', result: 'OK' }] }),
          node({ nodeId: 'n2', nodeLabel: 'Analyze', agentName: 'Analyzer', status: 'failed', cost: 0.01, retryCount: 2, toolCalls: [{ tool: 'llm', result: 'timeout error' }] }),
          node({ nodeId: 'n3', nodeLabel: 'Human Approval', status: 'completed', executionTimeMs: 60_000 }),
        ],
      }),
    ]);
    expect(stats.agentSuccessRate).toBe(50);
    expect(stats.toolFailureRate).toBe(50);
    expect(stats.retryRate).toBeCloseTo(33.333, 2);
    expect(stats.avgApprovalWaitMs).toBe(60_000);
    expect(stats.costByAgent).toEqual([
      { name: 'Retriever', cost: 0.02 },
      { name: 'Analyzer', cost: 0.01 },
    ]);
  });
});

describe('formatters', () => {
  it('formats percents and durations', () => {
    expect(formatPct(88.8)).toBe('89%');
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(3800)).toBe('3.8s');
    expect(formatDuration(120_000)).toBe('2.0m');
  });
});
