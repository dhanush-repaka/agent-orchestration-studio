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
  extraStartNodeIds?: string[];
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

export function approvalNodeId(
  run: Pick<WorkflowRun, 'approvalNodeId' | 'nodeExecutions'>,
  workflow?: { nodes: Array<{ id: string; data: { nodeType?: string } }> },
): string | undefined {
  if (run.approvalNodeId) return run.approvalNodeId;
  const waiting = run.nodeExecutions.find((n) => n.status === 'waiting-approval')?.nodeId;
  if (waiting) return waiting;
  if (!workflow) return undefined;
  const finished = new Set(
    run.nodeExecutions
      .filter((n) => n.status === 'completed' || n.status === 'failed')
      .map((n) => n.nodeId),
  );
  return workflow.nodes.find((n) => n.data.nodeType === 'approval' && !finished.has(n.id))?.id;
}

export function continueAfterApproval(
  run: Pick<WorkflowRun, 'approvalNodeId' | 'nodeExecutions'>,
  edges: WorkflowEdge[],
  workflow?: { nodes: Array<{ id: string; data: { nodeType?: string } }> },
): ReplaySeed | null {
  const nodeId = approvalNodeId(run, workflow);
  if (!nodeId) return null;
  const nextIds = edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target);
  const nextId = nextIds[0];
  if (!nextId) return null;

  const seed = replaySeed(run, nextId, edges);
  const approved = JSON.stringify({ approved: true });
  seed.nodeOutputs[nodeId] = approved;
  const existing = run.nodeExecutions.find((n) => n.nodeId === nodeId);
  const now = new Date().toISOString();
  seed.extraStartNodeIds = nextIds.slice(1);
  seed.priorExecutions = [
    ...seed.priorExecutions.filter((n) => n.nodeId !== nodeId),
    {
      nodeId,
      nodeLabel: existing?.nodeLabel ?? 'Human Approval',
      status: 'completed',
      input: existing?.input,
      output: approved,
      tokenUsage: 0,
      cost: 0,
      executionTimeMs: existing?.executionTimeMs ?? 0,
      retryCount: 0,
      startedAt: existing?.startedAt ?? now,
      endedAt: now,
    },
  ];
  return seed;
}
