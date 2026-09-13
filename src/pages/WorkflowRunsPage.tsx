import { useStore } from '@/store';
import { ApprovalActions } from '@/components/ApprovalActions';
import { StatusBadge } from '@/components/StatusBadge';
import { supabase } from '@/lib/supabase';
import {
  PlayCircle, Search, ArrowRight, Clock, Zap, Coins, CheckCircle2,
  XCircle, Activity, Radio, RefreshCw, Inbox, Filter,
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import type { WorkflowRun } from '@/types';
import { envLabel, inCurrentEnvironment } from '@/lib/environments';
import { isServerTriggered, siblingRuns } from '@/lib/compareRuns';

type RealtimeStatus = 'connecting' | 'live' | 'offline';

export function WorkflowRunsPage() {
  const environment = useStore((s) => s.environment);
  const envDefs = useStore((s) => s.environments);
  const allRuns = useStore((s) => s.runs);
  const runs = allRuns.filter((r) => inCurrentEnvironment(r.environment, environment));
  const setPage = useStore((s) => s.setPage);
  const setSelectedRun = useStore((s) => s.setSelectedRun);
  const setCompareRuns = useStore((s) => s.setCompareRuns);
  const hydrateRuns = useStore((s) => s.hydrateRuns);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [refreshing, setRefreshing] = useState(false);

  // Realtime subscription to workflow_runs table
  useEffect(() => {
    setRealtimeStatus('connecting');
    const channel = supabase
      .channel('workflow_runs_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_runs' }, (payload) => {
        const runData = (payload.new as { data: WorkflowRun } | null)?.data;
        if (!runData) return;
        // Merge the realtime update into the store
        useStore.setState((s) => {
          const idx = s.runs.findIndex((r) => r.id === runData.id);
          if (idx >= 0) {
            const updated = [...s.runs];
            updated[idx] = runData;
            return { runs: updated };
          }
          return { runs: [runData, ...s.runs] };
        });
      })
      .subscribe((status) => {
        setRealtimeStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'offline' : 'connecting');
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await hydrateRuns();
    setTimeout(() => setRefreshing(false), 600);
  }, [hydrateRuns]);

  const stats = useMemo(() => {
    const running = runs.filter((r) => r.status === 'running');
    const completed = runs.filter((r) => r.status === 'completed');
    const failed = runs.filter((r) => r.status === 'failed');
    const totalTokens = runs.reduce((a, r) => a + (r.totalTokens ?? 0), 0);
    const totalCost = runs.reduce((a, r) => a + (r.estimatedCost ?? 0), 0);
    return { running, completed, failed, totalTokens, totalCost };
  }, [runs]);

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (search && !r.workflowName.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [runs, search, statusFilter]);

  const summaryCards = [
    { key: 'total', label: 'Total Runs', icon: PlayCircle, value: runs.length, color: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-950' },
    { key: 'running', label: 'Running Now', icon: Activity, value: stats.running.length, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950' },
    { key: 'completed', label: 'Completed', icon: CheckCircle2, value: stats.completed.length, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950' },
    { key: 'failed', label: 'Failed', icon: XCircle, value: stats.failed.length, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950' },
    { key: 'tokens', label: 'Total Tokens', icon: Zap, value: stats.totalTokens > 0 ? `${(stats.totalTokens / 1000).toFixed(1)}K` : '—', color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950' },
    { key: 'cost', label: 'Total Cost', icon: Coins, value: stats.totalCost > 0 ? `$${stats.totalCost.toFixed(2)}` : '—', color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950' },
  ];

  const realtimeConfig = {
    live: { dot: 'bg-emerald-500 animate-pulse', text: 'text-emerald-600 dark:text-emerald-400', label: 'Live' },
    connecting: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-600 dark:text-amber-400', label: 'Connecting…' },
    offline: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Offline' },
  };
  const rt = realtimeConfig[realtimeStatus];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Workflow Runs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{runs.length} runs in {envLabel(environment, envDefs)} · Monitor and inspect executions</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 ${rt.text}`}>
            <Radio className="w-4 h-4" />
            <span className="text-xs font-medium">{rt.label}</span>
            <span className={`w-2 h-2 rounded-full ${rt.dot}`} />
          </div>
          <button onClick={handleRefresh} className="btn-secondary" disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((c) => (
          <div key={c.key} className="card p-3 card-hover">
            <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center mb-2`}>
              <c.icon className={`w-4 h-4 ${c.color}`} />
            </div>
            <p className="text-xl font-bold text-slate-900 dark:text-white">{c.value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search by workflow name..." aria-label="Search workflow runs" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter runs by status">
            <option value="all">All Statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
            <option value="waiting-approval">Waiting Approval</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Run ID</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Workflow</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Triggered By</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Env</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Started</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Duration</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Tokens</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Cost</th>
                  <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition" onClick={() => { setSelectedRun(r.id); setPage('run-details'); }}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">{r.id}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-white">{r.workflowName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">v{r.workflowVersion}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-2">
                        <StatusBadge status={r.status} />
                        <ApprovalActions runId={r.id} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div className="flex flex-col gap-1">
                        <span>{r.triggeredBy}</span>
                        {isServerTriggered(r.triggeredBy) && (
                          <span className="badge w-fit bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300">Server</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 capitalize">{r.environment}</span></td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatRelative(r.startTime)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : r.status === 'running' || r.status === 'waiting-approval' ? <span className={r.status === 'waiting-approval' ? 'text-purple-600 dark:text-purple-400' : 'text-amber-600 dark:text-amber-400'}>{r.status === 'waiting-approval' ? 'waiting…' : 'in progress…'}</span> : '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.totalTokens > 0 ? r.totalTokens.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.estimatedCost > 0 ? `$${r.estimatedCost.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {siblingRuns(r, allRuns).length > 0 && (
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            aria-label={`Compare ${r.workflowName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              const peer = siblingRuns(r, allRuns)[0];
                              setCompareRuns(r.id, peer?.id);
                            }}
                          >
                            Compare
                          </button>
                        )}
                        <button className="btn-ghost p-1.5" aria-label={`Open run ${r.id}`}><ArrowRight className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {runs.length === 0 ? 'No workflow runs yet' : 'No runs match your filters'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {runs.length === 0 ? 'Execute a workflow to see runs appear here in real time' : 'Try adjusting or clearing your search and filters'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
