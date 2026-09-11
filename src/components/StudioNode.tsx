import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStore } from '@/store';
import { Icon } from '@/components/Icon';
import { getStatusStyle } from '@/components/StatusBadge';
import { previewRunOutput } from '@/lib/output';
import type { WorkflowNodeData } from '@/types';
import { AlertCircle } from 'lucide-react';

const KIND_COLORS: Record<string, string> = {
  agent: 'border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-950',
  control: 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950',
  data: 'border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950',
  integration: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950',
};

const NODE_ICONS: Record<string, string> = {
  start: 'Play', end: 'Square', condition: 'GitBranch', switch: 'Shuffle',
  router: 'Route', loop: 'Repeat', parallel: 'GitMerge', merge: 'Combine',
  wait: 'Clock', retry: 'RotateCw', approval: 'UserCheck', 'error-handler': 'AlertTriangle',
  input: 'ArrowDownToLine', output: 'ArrowUpFromLine', transform: 'Wand2', filter: 'Filter',
  map: 'Map', 'json-parser': 'Braces', 'file-reader': 'File', 'db-query': 'Database', 'api-request': 'Globe',
  'azure-devops': 'Boxes', github: 'Github', 'playwright-mcp': 'MousePointerClick',
  'azure-devops-mcp': 'Network', sharepoint: 'FolderOpen', email: 'Mail',
  teams: 'MessageSquare', slack: 'Hash', powerbi: 'BarChart3', 'rest-api': 'Webhook',
};

function StudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData;
  const runOutput = useStore((s) => s.runOutputs[id]);
  const runError = useStore((s) => s.runErrors[id]);
  const pending = useStore((s) => s.pendingApproval);
  const status = nodeData.status;
  const style = getStatusStyle(status);
  const iconName = nodeData.icon || NODE_ICONS[nodeData.nodeType] || nodeData.nodeType;
  const kindColor = KIND_COLORS[nodeData.kind] ?? KIND_COLORS.control;
  const isRunning = status === 'running';
  const isFailed = status === 'failed';
  const isWaiting = status === 'waiting-approval' || pending?.nodeId === id;
  const notConfigured = status === 'not-configured' || (nodeData.kind === 'agent' && !nodeData.agentId);
  const subtitle = nodeData.kind === 'agent'
    ? (nodeData.agentType || nodeData.nodeType)
    : nodeData.nodeType;
  const preview = runError || (runOutput ? previewRunOutput(runOutput, 160) : '');

  return (
    <div
      className={`relative rounded-xl border-2 px-3 py-2.5 min-w-48 max-w-64 transition-all ${kindColor} ${selected ? 'ring-2 ring-brand-400 ring-offset-2 dark:ring-offset-slate-950' : ''} ${isRunning ? 'ring-2 ring-amber-400 animate-pulse-soft' : ''} ${isFailed ? 'ring-2 ring-red-400' : ''} ${isWaiting ? 'ring-2 ring-purple-400' : ''}`}
    >
      {nodeData.nodeType !== 'start' && (
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-slate-400 dark:bg-slate-500 border-2 border-white dark:border-slate-900" />
      )}

      {nodeData.nodeType === 'condition' || nodeData.nodeType === 'switch' || nodeData.nodeType === 'router' ? (
        <>
          <Handle id="out-true" type="source" position={Position.Right} style={{ top: '30%' }} className="w-3 h-3 bg-emerald-500 border-2 border-white dark:border-slate-900" />
          <Handle id="out-false" type="source" position={Position.Right} style={{ top: '70%' }} className="w-3 h-3 bg-red-500 border-2 border-white dark:border-slate-900" />
        </>
      ) : nodeData.nodeType !== 'end' ? (
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-brand-500 border-2 border-white dark:border-slate-900" />
      ) : null}

      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${style.bg}`}>
          <Icon name={iconName} className={`w-4 h-4 ${style.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{nodeData.label}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{subtitle}</p>
        </div>
        {notConfigured && <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
      </div>

      <div className="flex items-center gap-1 mt-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
        <span className={`text-[10px] ${style.text}`}>{notConfigured && nodeData.kind === 'agent' && !nodeData.agentId ? 'Unbound' : style.label}</span>
      </div>

      {preview && (
        <pre className={`nowheel nodrag mt-1.5 text-[10px] leading-snug rounded-md px-1.5 py-1 max-h-14 overflow-hidden font-mono whitespace-pre-wrap break-all ${runError ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/70' : 'text-slate-600 dark:text-slate-300 bg-white/70 dark:bg-slate-950/50'}`}>
          {preview}
        </pre>
      )}
    </div>
  );
}

export const StudioNode = memo(StudioNodeComponent);
