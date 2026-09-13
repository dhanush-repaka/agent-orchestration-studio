import { describe, expect, it } from 'vitest';
import { approvalNodeId, continueAfterApproval, descendantNodeIds, replaySeed } from '@/lib/replay';
import type { NodeExecution, WorkflowEdge } from '@/types';

const edges: WorkflowEdge[] = [
  { id: 'e1', source: 'start', target: 'retrieve' },
  { id: 'e2', source: 'retrieve', target: 'generate' },
  { id: 'e3', source: 'generate', target: 'upload' },
  { id: 'e4', source: 'retrieve', target: 'notify' },
];

function exec(nodeId: string, output: string): NodeExecution {
  return {
    nodeId,
    nodeLabel: nodeId,
    status: 'completed',
    output,
    tokenUsage: 0,
    cost: 0,
    executionTimeMs: 1,
    retryCount: 0,
    startedAt: '2026-08-17T12:00:00Z',
  };
}

describe('descendantNodeIds', () => {
  it('includes every node reachable downstream, not siblings of ancestors', () => {
    expect([...descendantNodeIds('generate', edges)].sort()).toEqual(['upload']);
    expect([...descendantNodeIds('retrieve', edges)].sort()).toEqual(['generate', 'notify', 'upload']);
  });
});

describe('replaySeed', () => {
  it('keeps stored outputs for upstream and sibling nodes', () => {
    const seed = replaySeed({
      nodeExecutions: [
        exec('start', '{"workItemId":21}'),
        exec('retrieve', '{"title":"Login"}'),
        exec('generate', '{"testCases":[]}'),
        exec('notify', '{"sent":true}'),
        exec('upload', '{"error":"timeout"}'),
      ],
    }, 'generate', edges);

    expect(seed.fromNodeId).toBe('generate');
    expect(seed.nodeOutputs).toEqual({
      start: '{"workItemId":21}',
      retrieve: '{"title":"Login"}',
      notify: '{"sent":true}',
    });
    expect(seed.priorExecutions.map((n) => n.nodeId)).toEqual(['start', 'retrieve', 'notify']);
  });

  it('starts from the chosen node even when it never completed', () => {
    const seed = replaySeed({
      nodeExecutions: [
        exec('start', '{"workItemId":21}'),
        exec('retrieve', '{"title":"Login"}'),
      ],
    }, 'generate', edges);

    expect(seed.nodeOutputs.retrieve).toBe('{"title":"Login"}');
    expect(seed.priorExecutions.map((n) => n.nodeId)).toEqual(['start', 'retrieve']);
  });
});

describe('continueAfterApproval', () => {
  it('resumes at the first node after the waiting approval', () => {
    const seed = continueAfterApproval({
      approvalNodeId: 'generate',
      nodeExecutions: [
        exec('start', '{"workItemId":21}'),
        exec('retrieve', '{"title":"Login"}'),
        {
          ...exec('generate', ''),
          status: 'waiting-approval',
          output: undefined,
          nodeLabel: 'Human Approval',
        },
      ],
    }, edges);

    expect(seed?.fromNodeId).toBe('upload');
    expect(seed?.extraStartNodeIds).toEqual([]);
    expect(seed?.nodeOutputs.generate).toBe('{"approved":true}');
    expect(seed?.priorExecutions.find((n) => n.nodeId === 'generate')?.status).toBe('completed');
    expect(seed?.priorExecutions.map((n) => n.nodeId)).toEqual(['start', 'retrieve', 'generate']);
  });

  it('queues every node after a branching approval', () => {
    const seed = continueAfterApproval({
      approvalNodeId: 'retrieve',
      nodeExecutions: [
        exec('start', '{"workItemId":21}'),
        { ...exec('retrieve', ''), status: 'waiting-approval', output: undefined },
      ],
    }, edges);

    expect(seed?.fromNodeId).toBe('generate');
    expect(seed?.extraStartNodeIds).toEqual(['notify']);
  });

  it('returns null when there is no next node', () => {
    expect(continueAfterApproval({
      approvalNodeId: 'upload',
      nodeExecutions: [exec('upload', '{}')],
    }, edges)).toBeNull();
  });

  it('infers the unfinished approval node from the workflow graph', () => {
    expect(approvalNodeId({
      nodeExecutions: [exec('start', '{}'), exec('retrieve', '{}')],
    }, {
      nodes: [
        { id: 'start', data: { nodeType: 'start' } },
        { id: 'retrieve', data: { nodeType: 'http-request' } },
        { id: 'generate', data: { nodeType: 'approval' } },
      ],
    })).toBe('generate');
  });
});
