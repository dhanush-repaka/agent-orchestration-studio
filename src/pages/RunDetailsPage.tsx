import { useState } from 'react';
import { useStore } from '@/store';
import { StatusBadge } from '@/components/StatusBadge';
import {
  ArrowLeft, Clock, Zap, Coins, CheckCircle2, XCircle, Play, RotateCw,
  Download, ChevronDown, ChevronRight, AlertCircle, User, Cpu, Wrench,
  BookOpen, Quote, GitCompare,
} from 'lucide-react';
import { downloadText } from '@/lib/download';
import { ApprovalActions } from '@/components/ApprovalActions';
import { findPlaywrightReportOutput, PlaywrightReportButton } from '@/components/PlaywrightReportButton';
import { formatRunOutput, reviewOutputFromRun } from '@/lib/output';
import { canRole } from '@/lib/roles';
import { isServerTriggered, siblingRuns } from '@/lib/compareRuns';
import type { NodeExecution } from '@/types';

export function RunDetailsPage() {
  const runs = useStore((s) => s.runs);
  const selectedRunId = useStore((s) => s.selectedRunId);
  const setPage = useStore((s) => s.setPage);
  const addToast = useStore((s) => s.addToast);
  const replayFrom = useStore((s) => s.replayFrom);
  const rerunFrom = useStore((s) => s.rerunFrom);
  const runningWorkflowId = useStore((s) => s.runningWorkflowId);
  const canRun = canRole(useStore((s) => s.currentUser.role), 'workflows.run');
  const setCompareRuns = useStore((s) => s.setCompareRuns);

  const run = runs.find((r) => r.id === selectedRunId);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<string>('all');

  if (!run) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500 dark:text-slate-400">No run selected.</p>
        <button onClick={() => setPage('workflow-runs')} className="btn-primary mt-4">Back to Runs</button>
      </div>
    );
  }

  const filteredLogs = run.logs.filter((l) => logFilter === 'all' || l.level === logFilter);
  const reviewOutput = run.status === 'waiting-approval' ? reviewOutputFromRun(run) : undefined;
  const peers = siblingRuns(run, runs);

  const handleDownloadLogs = () => {
    const text = run.logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`).join('\n');
    downloadText(`run-${run.id}-logs.txt`, text, 'text/plain');
    addToast('Logs downloaded', 'success');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setPage('workflow-runs')} className="btn-ghost p-2"><ArrowLeft className="w-5 h-5" /></button>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Run Details</h1>
            <StatusBadge status={run.status} />
            {isServerTriggered(run.triggeredBy) && (
              <span className="badge bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300">Server</span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{run.workflowName} · v{run.workflowVersion} · {run.id}</p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {canRun && (
            <button
              onClick={() => rerunFrom(run.id)}
              disabled={run.status !== 'failed' || !!runningWorkflowId}
              className="btn-secondary"
              aria-label="Retry failed run"
            >
              <RotateCw className="w-4 h-4" /> Retry Failed
            </button>
          )}
          {canRun && (
            <button
              onClick={() => rerunFrom(run.id)}
              disabled={!!runningWorkflowId}
              className="btn-secondary"
              aria-label="Re-run workflow"
            >
              <Play className="w-4 h-4" /> Re-run
            </button>
          )}
          {peers.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCompareRuns(run.id, peers[0].id)}
            >
              <GitCompare className="w-4 h-4" /> Compare
            </button>
          )}
          <ApprovalActions runId={run.id} />
          <PlaywrightReportButton output={findPlaywrightReportOutput(run.nodeExecutions)} />
          <button onClick={handleDownloadLogs} className="btn-secondary"><Download className="w-4 h-4" /> Logs</button>
        </div>
      </div>

      {run.status === 'waiting-approval' && (
        <div className="card p-4 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 space-y-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">Human approval required</p>
            <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
              This run is paused. Approve to continue from the next node, or reject to fail it.
            </p>
          </div>
          {reviewOutput && (
            <pre className="max-h-48 overflow-auto rounded-lg border border-purple-200 dark:border-purple-800 bg-white/70 dark:bg-slate-950/50 px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
              {formatRunOutput(reviewOutput)}
            </pre>
          )}
          <ApprovalActions runId={run.id} />
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <SummaryCard icon={Clock} label="Duration" value={run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'} color="text-amber-600" />
        <SummaryCard icon={Zap} label="Total Tokens" value={run.totalTokens.toLocaleString()} color="text-indigo-600" />
        <SummaryCard icon={Coins} label="Est. Cost" value={`$${run.estimatedCost.toFixed(2)}`} color="text-teal-600" />
        <SummaryCard icon={User} label="Triggered By" value={run.triggeredBy} color="text-slate-600" />
        <SummaryCard icon={CheckCircle2} label="Start" value={run.startTime.slice(11, 19)} color="text-emerald-600" />
        <SummaryCard icon={run.status === 'failed' ? XCircle : CheckCircle2} label="End" value={run.endTime?.slice(11, 19) ?? '—'} color={run.status === 'failed' ? 'text-red-600' : 'text-emerald-600'} />
      </div>

      {/* Node executions */}
      <div className="card">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="section-title">Agent Execution Details</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{run.nodeExecutions.length} nodes executed</p>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {run.nodeExecutions.map((ne) => (
            <NodeExecRow
              key={`${ne.nodeId}-${ne.startedAt}`}
              ne={ne}
              expanded={expandedNode === ne.nodeId}
              onToggle={() => setExpandedNode(expandedNode === ne.nodeId ? null : ne.nodeId)}
              onReplay={() => replayFrom(run.id, ne.nodeId)}
              canReplay={canRun && !runningWorkflowId}
            />
          ))}
        </div>
      </div>

      {/* Logs */}
      <div className="card">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="section-title">Execution Logs</h3>
          <div className="flex gap-2">
            {['all', 'info', 'warning', 'error', 'debug'].map((f) => (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition ${logFilter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 max-h-80 overflow-y-auto font-mono text-xs space-y-1">
          {filteredLogs.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="text-slate-400">{l.timestamp.slice(11, 19)}</span>
              <span className={`font-semibold ${l.level === 'error' ? 'text-red-500' : l.level === 'warning' ? 'text-amber-500' : l.level === 'debug' ? 'text-slate-400' : 'text-emerald-500'}`}>
                [{l.level.toUpperCase()}]
              </span>
              <span className="text-slate-400">[{l.source}]</span>
              <span className="text-slate-700 dark:text-slate-300">{l.message}</span>
            </div>
          ))}
          {filteredLogs.length === 0 && <p className="text-slate-400 text-center py-4">No logs for this filter</p>}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: typeof Clock; label: string; value: string; color: string }) {
  return (
    <div className="card p-3">
      <Icon className={`w-4 h-4 mb-1 ${color}`} />
      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function NodeExecRow({
  ne, expanded, onToggle, onReplay, canReplay,
}: {
  ne: NodeExecution;
  expanded: boolean;
  onToggle: () => void;
  onReplay: () => void;
  canReplay: boolean;
}) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition text-left">
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ne.status === 'completed' ? 'bg-emerald-50 dark:bg-emerald-950' : ne.status === 'failed' ? 'bg-red-50 dark:bg-red-950' : 'bg-slate-100 dark:bg-slate-800'}`}>
          {ne.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : ne.status === 'failed' ? <XCircle className="w-4 h-4 text-red-600" /> : <AlertCircle className="w-4 h-4 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-white">{ne.nodeLabel}</p>
          {ne.agentName && <p className="text-xs text-slate-500 dark:text-slate-400">{ne.agentName}</p>}
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {ne.tokenUsage.toLocaleString()}</span>
          <span className="flex items-center gap-1"><Coins className="w-3 h-3" /> ${ne.cost.toFixed(2)}</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {(ne.executionTimeMs / 1000).toFixed(1)}s</span>
          <StatusBadge status={ne.status} />
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pl-12 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="lg:col-span-2 flex justify-end gap-2">
            <PlaywrightReportButton output={ne.output} />
            <button
              type="button"
              onClick={onReplay}
              disabled={!canReplay}
              className="btn-secondary"
              aria-label={`Replay from ${ne.nodeLabel}`}
            >
              <Play className="w-4 h-4" /> Replay from here
            </button>
          </div>
          <DetailBlock label="Input" content={ne.input} />
          <DetailBlock label="Output" content={ne.output} />
          <DetailBlock label="Prompt Sent to Model" content={ne.prompt} icon={Cpu} />
          <div className="space-y-2">
            <DetailBlock label="Model" content={ne.model} icon={Cpu} />
            <DetailBlock label="Tool Calls" content={ne.toolCalls?.map((t) => `${t.tool}: ${t.result}`).join('\n')} icon={Wrench} />
            <DetailBlock label="Retrieved Knowledge" content={ne.knowledge?.join('\n')} icon={BookOpen} />
            <DetailBlock label="Citations" content={ne.citations?.join('\n')} icon={Quote} />
          </div>
          {ne.error && (
            <div className="lg:col-span-2 card p-3 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">Error Details</p>
              <p className="text-xs font-mono text-red-600 dark:text-red-400">{ne.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, content, icon: Icon }: { label: string; content?: string; icon?: typeof Cpu }) {
  return (
    <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </p>
      <pre className="text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap overflow-x-auto">{content || '—'}</pre>
    </div>
  );
}
