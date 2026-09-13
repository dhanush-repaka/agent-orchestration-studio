import type { Workflow, WorkflowVersion } from '@/types';

export function snapshotWorkflow(workflow: Workflow, savedBy: string, savedAt: string): WorkflowVersion {
  return {
    version: workflow.version,
    savedAt,
    savedBy,
    nodeCount: workflow.nodes.length,
    labels: workflow.nodes.map((node) => node.data.label),
    nodes: workflow.nodes.map((node) => ({ ...node, data: { ...node.data } })),
    edges: workflow.edges.map((edge) => ({ ...edge })),
  };
}

export function pushWorkflowVersion(workflow: Workflow, snap: WorkflowVersion, max = 10): WorkflowVersion[] {
  const prev = workflow.versions ?? [];
  const last = prev[0];
  if (last && last.labels.join('|') === snap.labels.join('|') && last.nodeCount === snap.nodeCount && last.version === snap.version) {
    return prev;
  }
  return [snap, ...prev].slice(0, max);
}

export function versionDiff(current: Workflow, version: WorkflowVersion): { added: string[]; removed: string[] } {
  const now = new Set(current.nodes.map((node) => node.data.label));
  const then = new Set(version.labels);
  return {
    added: [...now].filter((label) => !then.has(label)),
    removed: [...then].filter((label) => !now.has(label)),
  };
}
