import { useStore } from '@/store';
import { ApprovalActions } from '@/components/ApprovalActions';
import { StatusBadge } from '@/components/StatusBadge';
import { envLabel } from '@/lib/environments';
import { canRole } from '@/lib/roles';
import { Inbox, ArrowRight } from 'lucide-react';

export function ApprovalsPage() {
  const runs = useStore((s) => s.runs).filter((run) => run.status === 'waiting-approval');
  const environments = useStore((s) => s.environments);
  const setPage = useStore((s) => s.setPage);
  const setSelectedRun = useStore((s) => s.setSelectedRun);
  const role = useStore((s) => s.currentUser.role);
  const canApprove = canRole(role, 'runs.approve');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Approvals</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Runs waiting for a person, across every environment you can see.
        </p>
      </div>

      {!canApprove && (
        <p className="text-sm text-amber-700 dark:text-amber-300">Your role can view these runs but cannot approve them.</p>
      )}

      {runs.length === 0 ? (
        <div className="card p-12 text-center">
          <Inbox className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400">Nothing is waiting for approval.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="card p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{run.workflowName}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {envLabel(run.environment, environments)} · {run.triggeredBy} · {run.startTime.slice(0, 16)}
                </p>
              </div>
              <StatusBadge status={run.status} />
              <ApprovalActions runId={run.id} />
              <button
                type="button"
                className="btn-ghost p-2"
                aria-label={`Open run ${run.id}`}
                onClick={() => { setSelectedRun(run.id); setPage('run-details'); }}
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
