import type { NodeStatus, AgentStatus, RunStatus } from '@/types';

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  'not-configured': { dot: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Not Configured' },
  ready: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950', label: 'Ready' },
  running: { dot: 'bg-amber-500 animate-pulse', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950', label: 'Running' },
  completed: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950', label: 'Completed' },
  failed: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950', label: 'Failed' },
  'waiting-approval': { dot: 'bg-purple-500', text: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950', label: 'Waiting Approval' },
  skipped: { dot: 'bg-slate-300', text: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-900', label: 'Skipped' },
  draft: { dot: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Draft' },
  published: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950', label: 'Published' },
  archived: { dot: 'bg-slate-300', text: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-900', label: 'Archived' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950', label: 'Paused' },
  cancelled: { dot: 'bg-slate-400', text: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-900', label: 'Cancelled' },
};

export function StatusBadge({ status }: { status: NodeStatus | AgentStatus | RunStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES['not-configured'];
  return (
    <span className={`badge ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? STATUS_STYLES['not-configured'];
}
