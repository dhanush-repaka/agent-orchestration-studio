import type { NodeStatus, PendingApproval, Workflow, WorkflowRun } from '@/types';

export function formatRunOutput(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

export function previewRunOutput(raw?: string | null, max = 220): string {
  const formatted = formatRunOutput(raw);
  if (formatted.length <= max) return formatted;
  return `${formatted.slice(0, max).trimEnd()}…`;
}

export function mapsFromRun(run: WorkflowRun): {
  runOutputs: Record<string, string>;
  runErrors: Record<string, string>;
  runStatus: Record<string, NodeStatus>;
} {
  const runOutputs: Record<string, string> = {};
  const runErrors: Record<string, string> = {};
  const runStatus: Record<string, NodeStatus> = {};
  for (const ne of run.nodeExecutions ?? []) {
    runStatus[ne.nodeId] = ne.status;
    if (ne.output) runOutputs[ne.nodeId] = ne.output;
    if (ne.error) runErrors[ne.nodeId] = ne.error;
  }
  return { runOutputs, runErrors, runStatus };
}

export function reviewOutputFromRun(run: WorkflowRun, nodeId?: string): string | undefined {
  if (run.approvalReview) return run.approvalReview;
  const execs = run.nodeExecutions ?? [];
  if (nodeId) {
    const idx = execs.findIndex((n) => n.nodeId === nodeId);
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        if (execs[i].output) return execs[i].output;
      }
    }
  }
  for (let i = execs.length - 1; i >= 0; i--) {
    if (execs[i].nodeId !== nodeId && execs[i].output) return execs[i].output;
  }
  return undefined;
}

export function pendingFromRun(run: WorkflowRun, workflow: Workflow): PendingApproval | null {
  if (run.status !== 'waiting-approval') return null;
  const nodeId = run.approvalNodeId
    ?? run.nodeExecutions.find((n) => n.status === 'waiting-approval')?.nodeId;
  if (!nodeId) return null;
  const node = workflow.nodes.find((n) => n.id === nodeId);
  const cfg = (node?.data.config ?? {}) as { approver?: string };
  return {
    workflowId: workflow.id,
    nodeId,
    label: run.nodeExecutions.find((n) => n.nodeId === nodeId)?.nodeLabel ?? node?.data.label ?? 'Approval',
    reviewOutput: reviewOutputFromRun(run, nodeId),
    approver: cfg.approver,
  };
}
