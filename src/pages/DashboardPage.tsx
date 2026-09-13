import { useStore } from '@/store';
import { ApprovalActions } from '@/components/ApprovalActions';
import { StatusBadge } from '@/components/StatusBadge';
import { Icon } from '@/components/Icon';
import {
  Bot, Workflow, PlayCircle, CheckCircle2, XCircle, Clock, Coins,
  TrendingUp, Activity, AlertTriangle, ArrowRight, Zap, Inbox,
} from 'lucide-react';
import { useMemo } from 'react';
import type { Agent, WorkflowRun } from '@/types';
import { envLabel, inCurrentEnvironment } from '@/lib/environments';
import { canRole } from '@/lib/roles';

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function last7DayLabels(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
  }
  return days;
}

function runsPerDay(runs: WorkflowRun[]): number[] {
  const now = new Date();
  const buckets = new Array(7).fill(0);
  for (const r of runs) {
    const d = new Date(r.startTime);
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff >= 0 && diff < 7) buckets[6 - diff] += 1;
  }
  return buckets;
}

function Sparkline({ data, color = '#3479f6', height = 40 }: { data: number[]; color?: string; height?: number }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${height - ((v - min) / range) * height}`).join(' ');
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function BarChart({ data, labels, color = 'bg-brand-500' }: { data: number[]; labels: string[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end justify-between gap-2 h-32">
      {data.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className={`w-full ${color} rounded-t-md transition-all`} style={{ height: `${(v / max) * 100}%`, minHeight: '4px' }} title={`${labels[i]}: ${v}`} />
          <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let offset = 0;
  const radius = 40, circumference = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-4">
      <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
        {segments.map((s, i) => {
          const len = (s.value / total) * circumference;
          const el = (
            <circle
              key={i}
              cx="50" cy="50" r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
        <text x="50" y="50" className="rotate-90" textAnchor="middle" dominantBaseline="middle" fontSize="14" fontWeight="600" fill="currentColor">
          {total}
        </text>
      </svg>
      <div className="space-y-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
            <span className="font-semibold text-slate-900 dark:text-white">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const store = useStore();
  const setPage = useStore((s) => s.setPage);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const setSelectedRun = useStore((s) => s.setSelectedRun);

  const environment = store.environment;
  const envDefs = store.environments;
  const agents = store.agents.filter((a) => inCurrentEnvironment(a.environment, environment));
  const workflows = store.workflows.filter((w) => inCurrentEnvironment(w.environment, environment));
  const runs = store.runs.filter((r) => inCurrentEnvironment(r.environment, environment));

  const stats = useMemo(() => {
    const runsToday = runs.filter((r) => isToday(r.startTime));
    const completed = runs.filter((r) => r.status === 'completed');
    const failed = runs.filter((r) => r.status === 'failed');
    const running = runs.filter((r) => r.status === 'running');
    const completedToday = runsToday.filter((r) => r.status === 'completed');
    const failedToday = runsToday.filter((r) => r.status === 'failed');
    const doneWithDuration = runs.filter((r) => r.durationMs);
    const avgTime = doneWithDuration.length
      ? Math.round(doneWithDuration.reduce((a, r) => a + (r.durationMs ?? 0), 0) / doneWithDuration.length / 1000)
      : 0;
    const totalTokens = runs.reduce((a, r) => a + (r.totalTokens ?? 0), 0);
    const totalCost = runs.reduce((a, r) => a + (r.estimatedCost ?? 0), 0);
    const pendingApprovals = runs.filter((r) => r.status === 'waiting-approval');

    // Token usage by agent type
    const tokenByAgent = new Map<string, number>();
    for (const r of runs) {
      for (const ne of r.nodeExecutions ?? []) {
        const key = ne.agentName ?? ne.nodeLabel ?? 'Unknown';
        tokenByAgent.set(key, (tokenByAgent.get(key) ?? 0) + (ne.tokenUsage ?? 0));
      }
    }

    // Model usage count
    const modelCounts = new Map<string, number>();
    for (const r of runs) {
      for (const ne of r.nodeExecutions ?? []) {
        if (ne.model) {
          modelCounts.set(ne.model, (modelCounts.get(ne.model) ?? 0) + 1);
        }
      }
    }

    // Avg response time by agent
    const timeByAgent = new Map<string, { sum: number; count: number }>();
    for (const r of runs) {
      for (const ne of r.nodeExecutions ?? []) {
        const key = ne.agentName ?? ne.nodeLabel ?? 'Unknown';
        const cur = timeByAgent.get(key) ?? { sum: 0, count: 0 };
        cur.sum += ne.executionTimeMs ?? 0;
        cur.count += 1;
        timeByAgent.set(key, cur);
      }
    }

    return {
      totalAgents: agents.filter((a) => a.persisted !== false).length,
      activeWorkflows: workflows.length,
      runsTodayCount: runsToday.length,
      completedCount: completed.length,
      completedTodayCount: completedToday.length,
      failedCount: failed.length,
      failedTodayCount: failedToday.length,
      runningCount: running.length,
      avgTime,
      totalTokens,
      totalCost,
      pendingApprovals,
      tokenByAgent,
      modelCounts,
      timeByAgent,
    };
  }, [agents, workflows, runs]);

  const recentAgents = useMemo(
    () => [...agents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
    [agents],
  );
  const recentWorkflows = useMemo(
    () => [...workflows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
    [workflows],
  );
  const recentRuns = useMemo(
    () => [...runs].sort((a, b) => b.startTime.localeCompare(a.startTime)).slice(0, 5),
    [runs],
  );

  const trendData = useMemo(() => runsPerDay(runs), [runs]);
  const trendLabels = useMemo(() => last7DayLabels(), []);

  const tokenChart = useMemo(() => {
    const entries = [...stats.tokenByAgent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      data: entries.map(([, v]) => v),
      labels: entries.map(([k]) => k.slice(0, 6)),
    };
  }, [stats.tokenByAgent]);

  const modelChart = useMemo(() => {
    const entries = [...stats.modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      data: entries.map(([, v]) => v),
      labels: entries.map(([k]) => k.slice(0, 8)),
    };
  }, [stats.modelCounts]);

  const timeChart = useMemo(() => {
    const entries = [...stats.timeByAgent.entries()]
      .map(([k, v]) => [k, v.count ? v.sum / v.count / 1000 : 0] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return {
      data: entries.map(([, v]) => Math.round(v * 10) / 10),
      labels: entries.map(([k]) => k.slice(0, 6)),
    };
  }, [stats.timeByAgent]);

  const summaryCards = [
    { key: 'agents', label: 'Total Agents', icon: Bot, value: stats.totalAgents, color: 'text-brand-600 dark:text-brand-400', bg: 'bg-brand-50 dark:bg-brand-950' },
    { key: 'workflows', label: 'Active Workflows', icon: Workflow, value: stats.activeWorkflows, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950' },
    { key: 'runs-today', label: 'Runs Today', icon: PlayCircle, value: stats.runsTodayCount, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-950' },
    { key: 'success', label: 'Successful Today', icon: CheckCircle2, value: stats.completedTodayCount, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950' },
    { key: 'failed', label: 'Failed Today', icon: XCircle, value: stats.failedTodayCount, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950' },
    { key: 'avg-time', label: 'Avg Execution Time', icon: Clock, value: stats.avgTime > 0 ? `${stats.avgTime}s` : '—', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950' },
    { key: 'tokens', label: 'Total Token Usage', icon: Zap, value: stats.totalTokens > 0 ? `${(stats.totalTokens / 1000).toFixed(1)}K` : '—', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950' },
    { key: 'cost', label: 'Estimated AI Cost', icon: Coins, value: stats.totalCost > 0 ? `$${stats.totalCost.toFixed(2)}` : '—', color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Overview for {envLabel(environment, envDefs)}</p>
        </div>
        <div className="flex gap-2">
          {canRole(store.currentUser.role, 'agents.write') && (
            <button onClick={() => setPage('agents')} className="btn-secondary"><Bot className="w-4 h-4" /> New Agent</button>
          )}
          <button onClick={() => setPage('workflows')} className="btn-primary"><Workflow className="w-4 h-4" /> Manage Workflows</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((c) => (
          <div key={c.key} className="card p-4 card-hover">
            <div className="flex items-center justify-between mb-2">
              <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center`}>
                <c.icon className={`w-5 h-5 ${c.color}`} />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{c.value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="section-title">Workflow Execution Trend</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Last 7 days</p>
            </div>
            <TrendingUp className="w-5 h-5 text-emerald-500" />
          </div>
          {runs.length > 0 ? (
            <>
              <Sparkline data={trendData} color="#3479f6" height={80} />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                {trendLabels.map((d) => <span key={d}>{d}</span>)}
              </div>
            </>
          ) : (
            <EmptyChart message="No runs yet" />
          )}
        </div>

        <div className="card p-5">
          <div className="mb-4">
            <h3 className="section-title">Success vs Failure</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">All time</p>
          </div>
          {runs.length > 0 ? (
            <DonutChart segments={[
              { label: 'Success', value: stats.completedCount, color: '#10b981' },
              { label: 'Failed', value: stats.failedCount, color: '#ef4444' },
              { label: 'Running', value: stats.runningCount, color: '#f59e0b' },
            ]} />
          ) : (
            <EmptyChart message="No runs yet" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h3 className="section-title mb-4">Token Usage by Agent</h3>
          {tokenChart.data.length > 0 ? (
            <BarChart data={tokenChart.data} labels={tokenChart.labels} />
          ) : (
            <EmptyChart message="No token data" />
          )}
        </div>
        <div className="card p-5">
          <h3 className="section-title mb-4">Model Usage</h3>
          {modelChart.data.length > 0 ? (
            <BarChart data={modelChart.data} labels={modelChart.labels} color="bg-violet-500" />
          ) : (
            <EmptyChart message="No model data" />
          )}
        </div>
        <div className="card p-5">
          <h3 className="section-title mb-4">Avg Response Time (s)</h3>
          {timeChart.data.length > 0 ? (
            <BarChart data={timeChart.data} labels={timeChart.labels} color="bg-emerald-500" />
          ) : (
            <EmptyChart message="No timing data" />
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent agents */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title">Recently Updated Agents</h3>
            <button onClick={() => setPage('agents')} className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {recentAgents.length > 0 ? recentAgents.map((a) => (
              <button
                key={a.id}
                onClick={() => { setSelectedAgent(a.id); setPage('agent-config'); }}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-950 flex items-center justify-center shrink-0">
                  <Icon name={a.icon} className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{a.displayName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{a.type} · v{a.version}</p>
                </div>
                <StatusBadge status={a.status} />
              </button>
            )) : <EmptyList message="No agents yet" />}
          </div>
        </div>

        {/* Recent runs */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title">Recent Workflow Runs</h3>
            <button onClick={() => setPage('workflow-runs')} className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {recentRuns.length > 0 ? recentRuns.map((r) => (
              <button
                key={r.id}
                onClick={() => { setSelectedRun(r.id); setPage('run-details'); }}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition text-left"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${r.status === 'completed' ? 'bg-emerald-50 dark:bg-emerald-950' : r.status === 'failed' ? 'bg-red-50 dark:bg-red-950' : 'bg-amber-50 dark:bg-amber-950'}`}>
                  {r.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    : r.status === 'failed' ? <XCircle className="w-5 h-5 text-red-600" />
                    : <Activity className="w-5 h-5 text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{r.workflowName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{r.triggeredBy} · {r.startTime.slice(0, 10)}</p>
                </div>
                <StatusBadge status={r.status} />
              </button>
            )) : <EmptyList message="No runs yet" />}
          </div>
        </div>
      </div>

      {/* Recent workflows + pending approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="section-title mb-3">Recently Modified Workflows</h3>
          <div className="space-y-2">
            {recentWorkflows.length > 0 ? recentWorkflows.map((w) => (
              <button
                key={w.id}
                onClick={() => { setSelectedWorkflow(w.id); setPage('workflow-builder'); }}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950 flex items-center justify-center shrink-0">
                  <Workflow className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{w.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{w.category} · v{w.version}</p>
                </div>
                {w.published ? <StatusBadge status="published" /> : <StatusBadge status="draft" />}
              </button>
            )) : <EmptyList message="No workflows yet" />}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-title">Pending Approvals</h3>
            <button type="button" onClick={() => setPage('approvals')} className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
              Open inbox
            </button>
          </div>
          <div className="space-y-2">
            {stats.pendingApprovals.length > 0 ? stats.pendingApprovals.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="flex-1 min-w-40">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Human Approval Required</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">{r.workflowName} · Run #{r.id}</p>
                </div>
                <ApprovalActions runId={r.id} />
                <button onClick={() => { setSelectedRun(r.id); setPage('run-details'); }} className="btn-secondary text-xs py-1.5">Review</button>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Inbox className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-400">No pending approvals</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-center">
      <Activity className="w-7 h-7 text-slate-300 dark:text-slate-600 mb-2" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}

function EmptyList({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Inbox className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
