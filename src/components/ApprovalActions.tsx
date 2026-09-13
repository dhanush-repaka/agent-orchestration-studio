import { useStore } from '@/store';
import { canRole } from '@/lib/roles';
import { CheckCircle2, XCircle } from 'lucide-react';

export function ApprovalActions({
  runId,
  className = '',
}: {
  runId: string;
  className?: string;
}) {
  const run = useStore((s) => s.runs.find((r) => r.id === runId));
  const decideApproval = useStore((s) => s.decideApproval);
  const runningWorkflowId = useStore((s) => s.runningWorkflowId);
  const serverRunId = useStore((s) => s.serverRunId);
  const role = useStore((s) => s.currentUser.role);
  if (!run || run.status !== 'waiting-approval') return null;
  if (!canRole(role, 'runs.approve')) return null;
  const busy = Boolean(runningWorkflowId && serverRunId !== runId);

  return (
    <div className={`flex items-center gap-2 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn-danger text-xs py-1.5"
        disabled={busy}
        aria-label={`Reject approval for run ${runId}`}
        onClick={() => decideApproval(runId, false)}
      >
        <XCircle className="w-3.5 h-3.5" /> Reject
      </button>
      <button
        type="button"
        className="btn-primary text-xs py-1.5"
        disabled={busy}
        aria-label={`Approve run ${runId}`}
        onClick={() => decideApproval(runId, true)}
      >
        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
      </button>
    </div>
  );
}
