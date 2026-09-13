import { boundAgentIds } from '@/lib/deploy';
import type { Agent, Evaluation, Workflow, WorkflowRun } from '@/types';

export function latestRunForWorkflow(runs: WorkflowRun[], workflowId: string): WorkflowRun | undefined {
  return [...runs]
    .filter((run) => run.workflowId === workflowId)
    .sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
}

export function evaluationReady(evaluation: Evaluation): boolean {
  if (!evaluation.cases.length) return true;
  if (evaluation.approvedForProduction) return true;
  if (evaluation.status !== 'completed') return false;
  return (evaluation.averageAccuracy ?? 0) >= 0.7;
}

export function promoteBlockers(
  workflow: Workflow,
  runs: WorkflowRun[],
  evaluations: Evaluation[],
  agents: Agent[],
): string[] {
  const reasons: string[] = [];
  const latest = latestRunForWorkflow(runs, workflow.id);
  if (!latest) reasons.push('Run this workflow successfully before deploying it');
  else if (latest.status === 'running' || latest.status === 'waiting-approval') {
    reasons.push('Wait for the latest run to finish before deploying');
  } else if (latest.status !== 'completed') {
    reasons.push('The latest run did not succeed. Fix it, then deploy');
  }

  const bound = new Set(boundAgentIds(workflow));
  for (const evaluation of evaluations) {
    if (!bound.has(evaluation.agentId) || !evaluation.cases.length) continue;
    const agent = agents.find((item) => item.id === evaluation.agentId);
    const name = agent?.displayName || evaluation.agentName || 'agent';
    if (!evaluationReady(evaluation)) {
      reasons.push(`${name} has an evaluation that has not passed`);
    }
  }
  return reasons;
}
