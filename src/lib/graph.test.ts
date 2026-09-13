import { describe, expect, it } from 'vitest';
import { sanitizeEdges } from '@/lib/graph';

describe('sanitizeEdges', () => {
  it('drops sourceHandle on non-branch nodes', () => {
    const nodes = [
      { id: 'n1', data: { nodeType: 'start' } },
      { id: 'n2', data: { nodeType: 'condition' } },
    ];
    const edges = [
      { source: 'n1', target: 'n2', sourceHandle: 'true' },
      { source: 'n2', target: 'n1', sourceHandle: 'false' },
    ];
    const clean = sanitizeEdges(nodes, edges);
    expect(clean[0].sourceHandle).toBeUndefined();
    expect(clean[1].sourceHandle).toBeUndefined();
  });

  it('keeps out and out-true handles that exist on the node', () => {
    const nodes = [
      { id: 'n1', data: { nodeType: 'start' } },
      { id: 'n2', data: { nodeType: 'condition' } },
    ];
    const edges = [
      { source: 'n1', target: 'n2', sourceHandle: 'out' },
      { source: 'n2', target: 'n1', sourceHandle: 'out-true' },
    ];
    const clean = sanitizeEdges(nodes, edges);
    expect(clean[0].sourceHandle).toBe('out');
    expect(clean[1].sourceHandle).toBe('out-true');
  });
});
