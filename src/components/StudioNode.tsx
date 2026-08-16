import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Icon } from '@/components/Icon';
import { getStatusStyle } from '@/components/StatusBadge';
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

function StudioNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData;
  const status = nodeData.status;
  const style = getStatusStyle(status);
  const iconName = NODE_ICONS[nodeData.nodeType] ?? nodeData.nodeType;
  const kindColor = KIND_COLORS[nodeData.kind] ?? KIND_COLORS.control;
  const isRunning = status === 'running';
  const isFailed = status === 'failed';
  const notConfigured = status === 'not-configured';

  return (
    <div
      className={`relative rounded-xl border-2 px-3 py-2.5 min-w-44 max-w-56 transition-all ${kindColor} ${selected ? 'ring-2 ring-brand-400 ring-offset-2 dark:ring-offset-slate-950' : ''} ${isRunning ? 'ring-2 ring-amber-400 animate-pulse-soft' : ''} ${isFailed ? 'ring-2 ring-red-400' : ''}`}
    >
      {/* Input handle */}
      {nodeData.nodeType !== 'start' && (
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-slate-400 dark:bg-slate-500 border-2 border-white dark:border-slate-900" />
      )}

      {/* Output handles */}
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
          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{nodeData.nodeType}</p>
        </div>
        {notConfigured && <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-1 mt-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
        <span className={`text-[10px] ${style.text}`}>{style.label}</span>
      </div>
    </div>
  );
}

export const StudioNode = memo(StudioNodeComponent);
