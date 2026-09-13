import { describe, expect, it } from 'vitest';
import { applyDataNode, collectLoopBody, resolveLoopItems } from '@/lib/dataNodes';
import type { InterpContext } from '@/lib/interpolate';
import type { WorkflowEdge, WorkflowNode } from '@/types';

const ctx = (previous: unknown): InterpContext => ({
  workflowInput: { workItemId: 21 },
  previousOutput: previous,
  nodes: {},
});

function node(id: string, nodeType: string): WorkflowNode {
  return {
    id,
    type: 'studioNode',
    position: { x: 0, y: 0 },
    data: { kind: 'control', nodeType, label: id, status: 'ready' },
  };
}

describe('data nodes', () => {
  it('transforms with a template', () => {
    expect(applyDataNode('transform', '{"title":"Login"}', {
      timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{"name":"{{previous_agent_output.title}}"}',
    }, ctx({ title: 'Login' }))).toEqual({ name: 'Login' });
  });

  it('filters an array', () => {
    const items = [{ severity: 'high' }, { severity: 'low' }];
    expect(applyDataNode('filter', JSON.stringify(items), {
      timeoutSec: 30, retryCount: 0, loggingLevel: 'info', expression: '{{previous_agent_output.severity}} == high',
    }, ctx(items))).toEqual([{ severity: 'high' }]);
  });

  it('parses JSON and a path', () => {
    expect(applyDataNode('json-parser', 'prefix {"datasets":[1,2]}', {
      timeoutSec: 30, retryCount: 0, loggingLevel: 'info', loopPath: 'datasets',
    }, ctx('prefix {"datasets":[1,2]}'))).toEqual([1, 2]);
  });

  it('resolves loop items from a path and collects the body', () => {
    expect(resolveLoopItems({ timeoutSec: 1, retryCount: 0, loggingLevel: 'info', loopPath: 'cases' }, ctx({ cases: ['a', 'b'] }))).toEqual(['a', 'b']);
    const nodes = new Map([
      ['loop', node('loop', 'loop')],
      ['agent', node('agent', 'transform')],
      ['end', node('end', 'end')],
    ]);
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'loop', target: 'agent' },
      { id: 'e2', source: 'agent', target: 'end' },
    ];
    const body = collectLoopBody('loop', nodes, edges);
    expect([...body.body]).toEqual(['agent']);
    expect(body.exits.map((edge) => edge.target)).toEqual(['end']);
  });
});
