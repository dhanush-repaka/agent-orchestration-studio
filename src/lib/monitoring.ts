import type { WorkflowRun } from '@/types';

export interface NamedCost {
  name: string;
  cost: number;
}

export interface MonitoringStats {
  runCount: number;
  completed: number;
  failed: number;
  workflowSuccessRate: number;
  agentSuccessRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalTokens: number;
  totalCost: number;
  toolFailureRate: number;
  retryRate: number;
  avgApprovalWaitMs: number;
  costByWorkflow: NamedCost[];
  costByAgent: NamedCost[];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function failedToolResult(result: string): boolean {
  return /\b(fail|failed|error|timeout)\b/i.test(result);
}

export function computeMonitoringStats(runs: WorkflowRun[]): MonitoringStats {
  const completed = runs.filter((r) => r.status === 'completed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const durations = runs
    .map((r) => r.durationMs)
    .filter((ms): ms is number => typeof ms === 'number' && ms > 0)
    .sort((a, b) => a - b);

  const nodes = runs.flatMap((r) => r.nodeExecutions);
  const agentNodes = nodes.filter((n) => n.agentName);
  const scoredAgents = agentNodes.filter((n) => n.status === 'completed' || n.status === 'failed');
  const agentOk = scoredAgents.filter((n) => n.status === 'completed').length;

  const toolCalls = nodes.flatMap((n) => n.toolCalls ?? []);
  const toolFails = toolCalls.filter((t) => failedToolResult(t.result)).length;
  const retried = nodes.filter((n) => n.retryCount > 0).length;

  const approvalMs = nodes
    .filter((n) => n.status === 'waiting-approval' || /approval/i.test(n.nodeLabel))
    .map((n) => n.executionTimeMs)
    .filter((ms) => ms > 0);

  const byWorkflow = new Map<string, number>();
  for (const run of runs) {
    byWorkflow.set(run.workflowName, (byWorkflow.get(run.workflowName) ?? 0) + run.estimatedCost);
  }

  const byAgent = new Map<string, number>();
  for (const node of agentNodes) {
    if (!node.agentName) continue;
    byAgent.set(node.agentName, (byAgent.get(node.agentName) ?? 0) + node.cost);
  }

  const rank = (map: Map<string, number>, limit: number): NamedCost[] =>
    [...map.entries()]
      .map(([name, cost]) => ({ name, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, limit);

  return {
    runCount: runs.length,
    completed,
    failed,
    workflowSuccessRate: runs.length ? (completed / runs.length) * 100 : 0,
    agentSuccessRate: scoredAgents.length ? (agentOk / scoredAgents.length) * 100 : 0,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    p95DurationMs: percentile(durations, 0.95),
    totalTokens: runs.reduce((a, r) => a + r.totalTokens, 0),
    totalCost: runs.reduce((a, r) => a + r.estimatedCost, 0),
    toolFailureRate: toolCalls.length ? (toolFails / toolCalls.length) * 100 : 0,
    retryRate: nodes.length ? (retried / nodes.length) * 100 : 0,
    avgApprovalWaitMs: approvalMs.length ? approvalMs.reduce((a, b) => a + b, 0) / approvalMs.length : 0,
    costByWorkflow: rank(byWorkflow, 4),
    costByAgent: rank(byAgent, 5),
  };
}

export function formatPct(value: number): string {
  return `${value.toFixed(0)}%`;
}

export function formatDuration(ms: number): string {
  if (!ms) return '—';
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokens(total: number): string {
  if (total >= 1000) return `${(total / 1000).toFixed(1)}K`;
  return total.toString();
}

export function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}
