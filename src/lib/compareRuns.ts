import type { WorkflowRun } from '@/types';

export interface RunNodeCompare {
  nodeId: string;
  label: string;
  leftStatus?: string;
  rightStatus?: string;
  leftOutput?: string;
  rightOutput?: string;
  match: boolean;
}

export interface RunCompare {
  left: WorkflowRun;
  right: WorkflowRun;
  sameWorkflow: boolean;
  sameStatus: boolean;
  nodes: RunNodeCompare[];
}

export function compareRuns(left: WorkflowRun, right: WorkflowRun): RunCompare {
  const leftById = new Map(left.nodeExecutions.map((node) => [node.nodeId, node]));
  const rightById = new Map(right.nodeExecutions.map((node) => [node.nodeId, node]));
  const ids = [...new Set([...leftById.keys(), ...rightById.keys()])];
  const nodes = ids.map((nodeId) => {
    const l = leftById.get(nodeId);
    const r = rightById.get(nodeId);
    const leftOutput = l?.output ?? '';
    const rightOutput = r?.output ?? '';
    return {
      nodeId,
      label: l?.nodeLabel || r?.nodeLabel || nodeId,
      leftStatus: l?.status,
      rightStatus: r?.status,
      leftOutput,
      rightOutput,
      match: l?.status === r?.status && leftOutput === rightOutput,
    };
  });
  return {
    left,
    right,
    sameWorkflow: left.workflowName === right.workflowName,
    sameStatus: left.status === right.status,
    nodes,
  };
}

export function siblingRuns(
  run: WorkflowRun,
  runs: WorkflowRun[],
): WorkflowRun[] {
  return runs.filter((item) => item.id !== run.id && item.workflowName === run.workflowName);
}

export function isServerTriggered(triggeredBy: string): boolean {
  return /^(schedule|webhook|api|server|github-webhook|ado-trigger)$/i.test(triggeredBy.trim());
}
