import { useStore } from '@/store';
import { StatusBadge } from '@/components/StatusBadge';
import { compareRuns, siblingRuns } from '@/lib/compareRuns';
import { envLabel } from '@/lib/environments';
import { GitCompare, ArrowLeft } from 'lucide-react';

export function RunComparePage() {
  const runs = useStore((s) => s.runs);
  const ids = useStore((s) => s.compareRunIds);
  const setCompareRuns = useStore((s) => s.setCompareRuns);
  const setPage = useStore((s) => s.setPage);
  const environments = useStore((s) => s.environments);
  const left = runs.find((run) => run.id === ids?.[0]);
  const right = runs.find((run) => run.id === ids?.[1]);

  if (!left) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Pick a run to compare.</p>
        <button type="button" className="btn-primary mt-4" onClick={() => setPage('workflow-runs')}>Back to runs</button>
      </div>
    );
  }

  const peers = siblingRuns(left, runs);
  const comparison = right ? compareRuns(left, right) : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <button type="button" className="btn-ghost p-2" onClick={() => setPage('run-details')} aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Compare runs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Same workflow name, different environments or attempts.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-xs text-slate-500">Left</p>
          <p className="font-semibold text-slate-900 dark:text-white">{left.workflowName}</p>
          <p className="text-xs text-slate-500">{envLabel(left.environment, environments)} · {left.id}</p>
          <StatusBadge status={left.status} />
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 mb-1">Right</p>
          <select
            className="input"
            value={right?.id ?? ''}
            onChange={(e) => { if (e.target.value) setCompareRuns(left.id, e.target.value); }}
          >
            <option value="">Select a run</option>
            {peers.map((run) => (
              <option key={run.id} value={run.id}>
                {envLabel(run.environment, environments)} · {run.status} · {run.startTime.slice(0, 16)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {comparison && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-slate-500" />
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {comparison.sameStatus ? 'Same run status' : 'Status differs'} · {comparison.nodes.filter((n) => n.match).length}/{comparison.nodes.length} nodes match
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-100 dark:bg-slate-800 text-xs">
            <div className="bg-white dark:bg-slate-900 p-3">
              <p className="font-medium mb-1">Input</p>
              <pre className="whitespace-pre-wrap font-mono text-[11px]">{left.runtimeInput || '—'}</pre>
            </div>
            <div className="bg-white dark:bg-slate-900 p-3">
              <p className="font-medium mb-1">Input</p>
              <pre className="whitespace-pre-wrap font-mono text-[11px]">{right?.runtimeInput || '—'}</pre>
            </div>
            {comparison.nodes.map((node) => (
              <div key={node.nodeId} className={`bg-white dark:bg-slate-900 p-3 col-span-2 grid grid-cols-2 gap-3 ${node.match ? '' : 'bg-amber-50/60 dark:bg-amber-950/20'}`}>
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">{node.label}</p>
                  <p className="text-slate-500">{node.leftStatus ?? 'missing'}</p>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] max-h-32 overflow-auto">{node.leftOutput || '—'}</pre>
                </div>
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-100">{node.label}</p>
                  <p className="text-slate-500">{node.rightStatus ?? 'missing'}</p>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] max-h-32 overflow-auto">{node.rightOutput || '—'}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
