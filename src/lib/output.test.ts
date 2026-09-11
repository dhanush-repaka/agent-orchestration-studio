import { describe, expect, it } from 'vitest';
import { formatRunOutput, pendingFromRun, previewRunOutput, reviewOutputFromRun } from './output';
import type { Workflow, WorkflowRun } from '@/types';

describe('run output helpers', () => {
  it('pretty-prints JSON and truncates previews', () => {
    expect(formatRunOutput('{"ok":true}')).toBe('{\n  "ok": true\n}');
    expect(previewRunOutput('plain text', 8)).toBe('plain te…');
  });

  it('builds a pending approval from a waiting run', () => {
    const workflow = {
      id: 'w1',
      nodes: [{
        id: 'n13',
        type: 'studioNode',
        position: { x: 0, y: 0 },
        data: { kind: 'control', nodeType: 'approval', label: 'Human Approval', status: 'waiting-approval', config: { approver: 'Marcus' } },
      }],
    } as Workflow;
    const run = {
      status: 'waiting-approval',
      approvalNodeId: 'n13',
      approvalReview: '{"report":"ok"}',
      nodeExecutions: [
        { nodeId: 'n6', nodeLabel: 'Report', status: 'completed', output: '{"report":"ok"}', tokenUsage: 0, cost: 0, executionTimeMs: 1, retryCount: 0, startedAt: '2026-09-11T00:00:00Z' },
      ],
    } as WorkflowRun;

    expect(reviewOutputFromRun(run, 'n13')).toBe('{"report":"ok"}');
    expect(pendingFromRun(run, workflow)).toMatchObject({
      workflowId: 'w1',
      nodeId: 'n13',
      label: 'Human Approval',
      approver: 'Marcus',
      reviewOutput: '{"report":"ok"}',
    });
  });
});
