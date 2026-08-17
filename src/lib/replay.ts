import type { NodeExecution, WorkflowEdge, WorkflowRun } from '@/types';

export function descendantNodeIds(fromNodeId: string, edges: WorkflowEdge[]): Set<string> {
  const ids = new Set<string>();
  const queue = [fromNodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== cur) continue;
      if (edge.target === fromNodeId || ids.has(edge.target)) continue;
      ids.add(edge.target);
      queue.push(edge.target);
    }
  }
  return ids;
}

export type ReplaySeed = {
  fromNodeId: string;
  nodeOutputs: Record<string, string>;
  priorExecutions: NodeExecution[];
};

export function replaySeed(
  run: Pick<WorkflowRun, 'nodeExecutions'>,
  fromNodeId: string,
  edges: WorkflowEdge[],
): ReplaySeed {
  const downstream = descendantNodeIds(fromNodeId, edges);
  const nodeOutputs: Record<string, string> = {};
  const priorExecutions: NodeExecution[] = [];

  for (const execution of run.nodeExecutions) {
    if (execution.nodeId === fromNodeId || downstream.has(execution.nodeId)) continue;
    if (execution.output) nodeOutputs[execution.nodeId] = execution.output;
    priorExecutions.push(execution);
  }

  return { fromNodeId, nodeOutputs, priorExecutions };
}
