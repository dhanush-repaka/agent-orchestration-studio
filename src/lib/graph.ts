import type { WorkflowEdge, WorkflowNode } from '@/types';

export const BRANCH_NODE_TYPES = new Set(['condition', 'switch', 'router']);
const BRANCH_HANDLES = new Set(['out-true', 'out-false']);
const LINEAR_HANDLES = new Set(['out', 'in']);

/** Drop sourceHandle values that don't exist on the source node (React Flow error #008). */
export function sanitizeEdges<T extends { source: string; sourceHandle?: string | null }>(
  nodes: Array<{ id: string; data?: { nodeType?: string } }>,
  edges: T[],
): T[] {
  const typeById = new Map(nodes.map((n) => [n.id, n.data?.nodeType]));
  return edges.map((e) => {
    if (!e.sourceHandle) return e;
    const nt = typeById.get(e.source);
    if (BRANCH_NODE_TYPES.has(nt ?? '')) {
      return BRANCH_HANDLES.has(e.sourceHandle) ? e : { ...e, sourceHandle: undefined };
    }
    if (LINEAR_HANDLES.has(e.sourceHandle)) return e;
    return { ...e, sourceHandle: undefined };
  });
}

export function sanitizeWorkflowGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowEdge[] {
  return sanitizeEdges(nodes, edges);
}
