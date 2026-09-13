import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store';
import { formatRunOutput } from '@/lib/output';
import { canRole } from '@/lib/roles';
import { PlaywrightReportButton } from '@/components/PlaywrightReportButton';
import { StatusBadge } from '@/components/StatusBadge';
import {
  CheckCircle2, ChevronDown, ChevronUp, UserCheck, X, XCircle,
} from 'lucide-react';

export function RunLivePanel({
  workflowId,
  selectedNodeId,
}: {
  workflowId: string;
  selectedNodeId: string | null;
}) {
  const canApprove = canRole(useStore((s) => s.currentUser.role), 'runs.approve');
  const runningWorkflowId = useStore((s) => s.runningWorkflowId);
  const serverRunId = useStore((s) => s.serverRunId);
  const runStatus = useStore((s) => s.runStatus);
  const runOutputs = useStore((s) => s.runOutputs);
  const runErrors = useStore((s) => s.runErrors);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const runs = useStore((s) => s.runs);
  const workflows = useStore((s) => s.workflows);
  const approveRun = useStore((s) => s.approveRun);
  const rejectRun = useStore((s) => s.rejectRun);
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(false);
    setCollapsed(false);
    setPinnedNodeId(null);
  }, [serverRunId, runningWorkflowId]);

  const wf = workflows.find((w) => w.id === workflowId);
  const run = runs.find((r) => r.id === serverRunId)
    ?? runs.find((r) => r.workflowId === workflowId);
  const isRunning = runningWorkflowId === workflowId;
  const pending = pendingApproval?.workflowId === workflowId ? pendingApproval : null;
  const outputIds = Object.keys(runOutputs);

  const activeNodeId = useMemo(() => {
    if (pinnedNodeId && runOutputs[pinnedNodeId]) return pinnedNodeId;
    if (selectedNodeId && (runOutputs[selectedNodeId] || runErrors[selectedNodeId] || runStatus[selectedNodeId])) {
      return selectedNodeId;
    }
    const latest = [...(run?.nodeExecutions ?? [])].reverse().find((n) => n.output || n.error);
    if (latest) return latest.nodeId;
    return outputIds[outputIds.length - 1] ?? null;
  }, [pinnedNodeId, selectedNodeId, runOutputs, runErrors, runStatus, run?.nodeExecutions, outputIds]);

  if (!pending && outputIds.length === 0 && !isRunning) return null;
  if (!pending && dismissed) return null;

  const nodeLabel = (id: string) => wf?.nodes.find((n) => n.id === id)?.data.label ?? id;
  const activeOutput = activeNodeId ? runOutputs[activeNodeId] : undefined;
  const activeError = activeNodeId ? runErrors[activeNodeId] : undefined;
  const activeStatus = activeNodeId ? runStatus[activeNodeId] : undefined;

  if (pending) {
    return (
      <div className="absolute bottom-3 left-3 z-20 w-[32rem] max-w-[calc(100%-7rem)]">
        <div className="card border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-purple-100 dark:border-purple-900 bg-purple-50 dark:bg-purple-950/60 flex items-start gap-2">
            <UserCheck className="w-4 h-4 text-purple-600 dark:text-purple-300 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">Human approval required</p>
              <p className="text-xs text-purple-700 dark:text-purple-300 truncate">
                {pending.label}{pending.approver ? ` · ${pending.approver}` : ''}
              </p>
            </div>
            <StatusBadge status="waiting-approval" />
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Review the previous agent output, then approve to continue or reject to stop and fail this run.
            </p>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                Output to review
              </p>
              <pre className="nowheel nodrag max-h-48 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-[11px] leading-relaxed font-mono text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                {formatRunOutput(pending.reviewOutput) || 'No upstream output was captured for this step.'}
              </pre>
            </div>
            {canApprove && (
              <div className="flex items-center gap-2 justify-end">
                <button type="button" onClick={() => rejectRun()} className="btn-danger text-sm" aria-label="Reject approval and fail run">
                  <XCircle className="w-4 h-4" /> Reject
                </button>
                <button type="button" onClick={() => approveRun()} className="btn-primary text-sm" aria-label="Approve and continue workflow">
                  <CheckCircle2 className="w-4 h-4" /> Approve
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-3 left-3 z-20 w-[30rem] max-w-[calc(100%-7rem)]">
      <div className="card shadow-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          {isRunning && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />}
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex-1 truncate">
            {isRunning ? 'Live agent output' : 'Last run output'}
          </p>
          {run && <StatusBadge status={run.status} />}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="btn-ghost p-1"
            aria-label={collapsed ? 'Expand live output' : 'Collapse live output'}
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button type="button" onClick={() => setDismissed(true)} className="btn-ghost p-1" aria-label="Dismiss live output">
            <X className="w-4 h-4" />
          </button>
        </div>
        {!collapsed && (
          <div className="p-3 space-y-2">
            {outputIds.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {outputIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPinnedNodeId(id)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition ${
                      activeNodeId === id
                        ? 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {nodeLabel(id)}
                  </button>
                ))}
              </div>
            )}
            {activeNodeId ? (
              <>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{nodeLabel(activeNodeId)}</p>
                  {activeStatus && <StatusBadge status={activeStatus} />}
                </div>
                {activeError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{activeError}</p>
                )}
                <PlaywrightReportButton output={activeOutput} className="btn-secondary text-xs" />
                <pre className="nowheel nodrag max-h-40 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-[11px] leading-relaxed font-mono text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                  {formatRunOutput(activeOutput) || (isRunning ? 'Waiting for this node to finish…' : 'No output')}
                </pre>
              </>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Agents will show their output here as they finish.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
