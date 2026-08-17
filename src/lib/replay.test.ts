import { describe, expect, it } from 'vitest';
import { descendantNodeIds, replaySeed } from '@/lib/replay';
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
