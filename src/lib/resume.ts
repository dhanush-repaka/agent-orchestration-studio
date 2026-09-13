import { replaySeed, type ReplaySeed } from '@/lib/replay';
import type { Workflow, WorkflowRun } from '@/types';

export function nextResumeNode(run: WorkflowRun, workflow: Workflow): string | undefined {
  const completed = new Set(
    run.nodeExecutions.filter((node) => node.status === 'completed' && node.output).map((node) => node.nodeId),
  );
  if (!completed.size) {
    return workflow.nodes.find((node) => node.data.nodeType === 'start')?.id ?? workflow.nodes[0]?.id;
  }
  for (const node of run.nodeExecutions) {
    if (node.status !== 'completed') continue;
    const next = workflow.edges.find((edge) => edge.source === node.nodeId && !completed.has(edge.target));
    if (next) return next.target;
  }
  return undefined;
}

export function resumeSeedForOrphan(run: WorkflowRun, workflow: Workflow): ReplaySeed | null {
  const fromNodeId = nextResumeNode(run, workflow);
  if (!fromNodeId) return null;
  return replaySeed(run, fromNodeId, workflow.edges);
}

export function orphanedRunningRun(runs: WorkflowRun[], liveRunId: string | null): WorkflowRun | undefined {
  return runs.find((run) => run.status === 'running' && run.id !== liveRunId);
}
