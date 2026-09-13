import { describe, expect, it } from 'vitest';
import { pushWorkflowVersion, snapshotWorkflow, versionDiff } from '@/lib/versions';
import type { Workflow, WorkflowNode } from '@/types';

function node(id: string, label = id): WorkflowNode {
  return {
    id,
    type: 'studioNode',
    position: { x: 0, y: 0 },
    data: { kind: 'control', nodeType: 'start', label, status: 'ready' },
  };
}

function workflow(labels: string[]): Workflow {
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
    nodes: labels.map((label, index) => node(`n${index}`, label)),
    edges: [],
    published: true,
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:00:00.000Z',
  };
}

describe('versions', () => {
  it('snapshots the graph and skips an identical push', () => {
    const wf = workflow(['Start', 'End']);
    const snap = snapshotWorkflow(wf, 'Ada', '2026-09-13T10:00:00.000Z');
    expect(snap.nodeCount).toBe(2);
    expect(snap.labels).toEqual(['Start', 'End']);
    const first = pushWorkflowVersion(wf, snap);
    expect(first).toHaveLength(1);
    expect(pushWorkflowVersion({ ...wf, versions: first }, snap)).toHaveLength(1);
  });

  it('diffs added and removed labels', () => {
    const previous = snapshotWorkflow(workflow(['Start', 'Agent']), 'Ada', '2026-09-13T10:00:00.000Z');
    const current = workflow(['Start', 'Review']);
    expect(versionDiff(current, previous)).toEqual({ added: ['Review'], removed: ['Agent'] });
  });
});
