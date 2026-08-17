import { useMemo, useState, useId, cloneElement, isValidElement, type ReactElement } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { useStore, newAgentSkeleton } from '@/store';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import {
  PROMPT_VARIABLES,
  type Agent, type InputBinding, type NodeRuntimeConfig, type WorkflowNodeData,
} from '@/types';
import {
  Settings2, X, Copy, Trash2, Upload, Boxes, ExternalLink, Plus,
  Bot, ArrowDownToLine, MessageSquareText, Cpu, Wrench, Timer, ArrowRight,
} from 'lucide-react';

type Tab = 'agent' | 'io' | 'prompt' | 'model' | 'tools' | 'runtime';

const TABS: { id: Tab; label: string; icon: typeof Bot }[] = [
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'io', label: 'Inputs', icon: ArrowDownToLine },
  { id: 'prompt', label: 'Prompt', icon: MessageSquareText },
  { id: 'model', label: 'Model', icon: Cpu },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'runtime', label: 'Runtime', icon: Timer },
];

export function defaultNodeConfig(): NodeRuntimeConfig {
  return { timeoutSec: 60, retryCount: 2, loggingLevel: 'info', inputMapping: '', outputMapping: '' };
}

function cfgOf(node: Node): NodeRuntimeConfig {
  const d = node.data as WorkflowNodeData;
  return { ...defaultNodeConfig(), ...(d.config as NodeRuntimeConfig | undefined) };
}

interface Props {
  selectedNode: Node;
  nodes: Node[];
  edges: Edge[];
  workflowId: string;
  onUpdate: (patch: Partial<WorkflowNodeData>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NodeInspector({ selectedNode, nodes, edges, workflowId, onUpdate, onDuplicate, onDelete, onClose }: Props) {
  const agents = useStore((s) => s.agents);
  const setPage = useStore((s) => s.setPage);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const createAgent = useStore((s) => s.createAgent);
  const addToast = useStore((s) => s.addToast);
  const [tab, setTab] = useState<Tab>('agent');

  const data = selectedNode.data as WorkflowNodeData;
  const cfg = cfgOf(selectedNode);
  const agent = agents.find((a) => a.id === data.agentId);
  const isAgent = data.kind === 'agent';
  const predecessors = nodes.filter((n) => edges.some((e) => e.target === selectedNode.id && e.source === n.id));

  const setCfg = (patch: Partial<NodeRuntimeConfig>) => {
    onUpdate({ config: { ...cfg, ...patch } });
  };

  const bindAgent = (id: string) => {
    const ag = useStore.getState().agents.find((a) => a.id === id);
    if (!ag) {
      onUpdate({ agentId: '', status: 'not-configured' });
      return;
    }
    const bindings: InputBinding[] = ag.inputs.map((inp) => {
      const name = inp.name.toLowerCase();
      if (name.includes('workitem') || name === 'workitemid') {
        return { inputName: inp.name, source: 'workflow', path: 'workItemId' };
      }
      return { inputName: inp.name, source: 'node', path: 'output', nodeId: predecessors[0]?.id };
    });
    onUpdate({
      agentId: ag.id,
      agentType: ag.type,
      label: ag.displayName,
      icon: ag.icon,
      status: 'ready',
      config: { ...cfg, inputBindings: bindings, timeoutSec: ag.timeoutSec, retryCount: ag.retryCount },
    });
  };

  const handleCreateAgent = () => {
    const created = { ...newAgentSkeleton(), persisted: true };
    createAgent(created);
    bindAgent(created.id);
    setSelectedAgent(created.id);
    addToast('New agent created and bound to this node', 'success');
  };

  const visibleTabs = useMemo(() => {
    if (!isAgent) return TABS.filter((t) => t.id === 'agent' || t.id === 'runtime');
    return TABS;
  }, [isAgent]);

  return (
    <aside className="w-[22rem] shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Settings2 className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{data.label}</h3>
        </div>
        <button onClick={onClose} className="btn-ghost p-1" aria-label="Close inspector"><X className="w-4 h-4" /></button>
      </div>

      <div className="px-2 pt-2 flex gap-0.5 overflow-x-auto border-b border-slate-200 dark:border-slate-800" role="tablist" aria-label="Node inspector">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-t-md whitespace-nowrap ${tab === t.id ? 'bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
          >
            <t.icon className="w-3 h-3" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'agent' && (
          <>
            <Field label="Node Name">
              <input className="input" value={data.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            </Field>
            <Field label="Node Type">
              <input className="input opacity-60" disabled value={data.nodeType} />
            </Field>

            {isAgent && (
              <>
                <Field label="Bound Agent">
                  <select className="input" value={data.agentId ?? ''} onChange={(e) => bindAgent(e.target.value)}>
                    <option value="">Select agent...</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.displayName} · {a.type}</option>
                    ))}
                  </select>
                </Field>
                <div className="flex gap-2">
                  <button onClick={handleCreateAgent} className="btn-secondary text-xs flex-1 justify-center"><Plus className="w-3.5 h-3.5" /> New agent</button>
                  {agent && (
                    <button
                      onClick={() => { setSelectedAgent(agent.id); setPage('agent-config'); }}
                      className="btn-secondary text-xs flex-1 justify-center"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Edit library
                    </button>
                  )}
                </div>
                {agent ? <AgentSummary agent={agent} /> : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Bind an agent or this node will fail at runtime.</p>
                )}
              </>
            )}

            {data.nodeType === 'condition' && (
              <Field label="Condition Expression">
                <input
                  className="input font-mono text-xs"
                  placeholder="{{nodes.n1.output.qualityScore}} >= 70"
                  value={cfg.expression ?? ''}
                  onChange={(e) => setCfg({ expression: e.target.value })}
                />
                <p className="text-[11px] text-slate-400 mt-1">True uses the green handle, false uses the red handle.</p>
              </Field>
            )}
            {data.nodeType === 'wait' && (
              <Field label="Wait Duration (ms)">
                <input type="number" className="input" value={cfg.duration ?? 1000} onChange={(e) => setCfg({ duration: Number(e.target.value) })} />
              </Field>
            )}
            {data.nodeType === 'loop' && (
              <>
                <Field label="Loop Count">
                  <input type="number" className="input" value={cfg.loopCount ?? 1} onChange={(e) => setCfg({ loopCount: Number(e.target.value) })} />
                </Field>
                <Field label="Or iterate path on previous output">
                  <input className="input font-mono text-xs" placeholder="testCases" value={cfg.loopPath ?? ''} onChange={(e) => setCfg({ loopPath: e.target.value })} />
                </Field>
              </>
            )}
            {data.nodeType === 'approval' && (
              <Field label="Approver">
                <input className="input" placeholder="Name or email" value={cfg.approver ?? ''} onChange={(e) => setCfg({ approver: e.target.value })} />
              </Field>
            )}
          </>
        )}

        {tab === 'io' && isAgent && (
          <IoTab agent={agent} cfg={cfg} nodes={nodes} selectedId={selectedNode.id} predecessors={predecessors} setCfg={setCfg} />
        )}

        {tab === 'prompt' && isAgent && (
          <PromptTab agent={agent} cfg={cfg} setCfg={setCfg} />
        )}

        {tab === 'model' && isAgent && (
          <ModelTab agent={agent} cfg={cfg} setCfg={setCfg} data={data} />
        )}

        {tab === 'tools' && isAgent && (
          <ToolsTab agent={agent} cfg={cfg} setCfg={setCfg} />
        )}

        {tab === 'runtime' && (
          <RuntimeTab
            cfg={cfg}
            setCfg={setCfg}
            notes={data.notes ?? ''}
            onNotes={(notes) => onUpdate({ notes })}
            nodeId={selectedNode.id}
            workflowId={workflowId}
          />
        )}
      </div>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2">
        <button onClick={onDuplicate} className="btn-secondary text-sm flex-1 justify-center"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
        <button onClick={onDelete} className="btn-danger text-sm" aria-label="Delete node"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-label'?: string }>, { id, 'aria-label': label })
    : children;
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {control}
    </div>
  );
}

function AgentSummary({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{agent.description || 'No description'}</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Type</p>
          <p className="text-slate-700 dark:text-slate-200">{agent.type}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Model</p>
          <p className="text-slate-700 dark:text-slate-200">{agent.modelName}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Inputs</p>
          <p className="text-slate-700 dark:text-slate-200">{agent.inputs.length}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Output</p>
          <p className="text-slate-700 dark:text-slate-200">{agent.output.format}</p>
        </div>
      </div>
    </div>
  );
}

function IoTab({
  agent, cfg, nodes, selectedId, predecessors, setCfg,
}: {
  agent: Agent | undefined;
  cfg: NodeRuntimeConfig;
  nodes: Node[];
  selectedId: string;
  predecessors: Node[];
  setCfg: (p: Partial<NodeRuntimeConfig>) => void;
}) {
  const inputs = agent?.inputs ?? [];
  const bindings = cfg.inputBindings ?? [];
  const others = nodes.filter((n) => n.id !== selectedId);

  const updateBinding = (inputName: string, patch: Partial<InputBinding>) => {
    const existing = bindings.find((b) => b.inputName === inputName);
    const next: InputBinding[] = existing
      ? bindings.map((b) => b.inputName === inputName ? { ...b, ...patch } : b)
      : [...bindings, { inputName, source: 'node', ...patch }];
    setCfg({ inputBindings: next });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">Map this agent’s declared inputs to workflow input, a previous node, or a static value. These bindings are used at runtime.</p>
      {inputs.length === 0 && <p className="text-xs text-slate-400">This agent has no declared inputs. Upstream node output is passed as context.</p>}
      {inputs.map((inp) => {
        const b = bindings.find((x) => x.inputName === inp.name) ?? {
          inputName: inp.name,
          source: 'node' as const,
          path: 'output',
          nodeId: predecessors[0]?.id,
        };
        return (
          <div key={inp.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{inp.label || inp.name}</p>
              <span className="text-[10px] text-slate-400">{inp.dataType}{inp.required ? ' · required' : ''}</span>
            </div>
            {inp.description && <p className="text-[11px] text-slate-400">{inp.description}</p>}
            <select
              className="input text-xs"
              value={b.source}
              onChange={(e) => updateBinding(inp.name, { source: e.target.value as InputBinding['source'] })}
            >
              <option value="workflow">Workflow input</option>
              <option value="node">Previous node</option>
              <option value="static">Static value</option>
            </select>
            {b.source === 'node' && (
              <select className="input text-xs" value={b.nodeId ?? ''} onChange={(e) => updateBinding(inp.name, { nodeId: e.target.value })}>
                <option value="">Immediate predecessor</option>
                {others.map((n) => (
                  <option key={n.id} value={n.id}>{(n.data as WorkflowNodeData).label}</option>
                ))}
              </select>
            )}
            {b.source !== 'static' && (
              <input
                className="input font-mono text-xs"
                placeholder={b.source === 'workflow' ? 'workItemId' : 'normalized.title'}
                value={b.path ?? ''}
                onChange={(e) => updateBinding(inp.name, { path: e.target.value })}
              />
            )}
            {b.source === 'static' && (
              <textarea
                className="input font-mono text-xs min-h-16"
                placeholder="Static JSON or text"
                value={b.staticValue ?? ''}
                onChange={(e) => updateBinding(inp.name, { staticValue: e.target.value })}
              />
            )}
          </div>
        );
      })}
      <Field label="Raw input mapping (optional)">
        <textarea className="input font-mono text-xs min-h-16" placeholder="{{previous_agent_output}}" value={cfg.inputMapping ?? ''} onChange={(e) => setCfg({ inputMapping: e.target.value })} />
      </Field>
    </div>
  );
}

function PromptTab({ agent, cfg, setCfg }: { agent: Agent | undefined; cfg: NodeRuntimeConfig; setCfg: (p: Partial<NodeRuntimeConfig>) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">Leave blank to use the library agent prompt. Overrides apply only to this node.</p>
      <Field label="System prompt override">
        <textarea
          className="input font-mono text-xs min-h-28"
          placeholder={agent?.prompt.systemPrompt || 'Inherited from agent'}
          value={cfg.systemPromptOverride ?? ''}
          onChange={(e) => setCfg({ systemPromptOverride: e.target.value })}
        />
      </Field>
      <Field label="User prompt override">
        <textarea
          className="input font-mono text-xs min-h-28"
          placeholder={agent?.prompt.userPromptTemplate || 'Inherited from agent'}
          value={cfg.userPromptOverride ?? ''}
          onChange={(e) => setCfg({ userPromptOverride: e.target.value })}
        />
      </Field>
      <div>
        <p className="label">Insert variable</p>
        <div className="flex flex-wrap gap-1">
          {PROMPT_VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              className="badge bg-brand-50 dark:bg-brand-950 text-brand-700 dark:text-brand-300 font-mono"
              onClick={() => setCfg({ userPromptOverride: `${cfg.userPromptOverride || agent?.prompt.userPromptTemplate || ''} ${v}` })}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {agent && !cfg.systemPromptOverride && !cfg.userPromptOverride && (
        <div className="rounded border border-slate-200 dark:border-slate-700 p-2 max-h-40 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">Library prompt</p>
          <pre className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{agent.prompt.systemPrompt}{'\n\n'}{agent.prompt.userPromptTemplate}</pre>
        </div>
      )}
    </div>
  );
}

function ModelTab({ agent, cfg, setCfg, data }: { agent: Agent | undefined; cfg: NodeRuntimeConfig; setCfg: (p: Partial<NodeRuntimeConfig>) => void; data: WorkflowNodeData }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Node-level overrides. Blank fields inherit from the bound agent.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Temperature">
          <input type="number" step="0.1" min={0} max={2} className="input text-xs" value={String(cfg.temperature ?? agent?.temperature ?? 0.2)} onChange={(e) => setCfg({ temperature: Number(e.target.value) })} />
        </Field>
        <Field label="Max tokens">
          <input type="number" className="input text-xs" value={String(cfg.maxTokens ?? agent?.maxTokens ?? 4000)} onChange={(e) => setCfg({ maxTokens: Number(e.target.value) })} />
        </Field>
        <Field label="Top P">
          <input type="number" step="0.05" min={0} max={1} className="input text-xs" value={String(cfg.topP ?? agent?.topP ?? 0.9)} onChange={(e) => setCfg({ topP: Number(e.target.value) })} />
        </Field>
        <Field label="Freq. penalty">
          <input type="number" step="0.1" className="input text-xs" value={String(cfg.frequencyPenalty ?? agent?.frequencyPenalty ?? 0)} onChange={(e) => setCfg({ frequencyPenalty: Number(e.target.value) })} />
        </Field>
      </div>

      {(data.nodeType === 'Data Retrieval' || agent?.type === 'Data Retrieval') && (
        <div className="space-y-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/30 p-3">
          <p className="text-xs font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Azure DevOps retrieval</p>
          <Field label="Organization"><input className="input text-xs" placeholder="from secret if blank" value={cfg.adoOrg ?? ''} onChange={(e) => setCfg({ adoOrg: e.target.value })} /></Field>
          <Field label="API version"><input className="input text-xs" value={cfg.adoApiVersion ?? '7.0'} onChange={(e) => setCfg({ adoApiVersion: e.target.value })} /></Field>
          <Field label="Work item ID source">
            <select className="input text-xs" value={cfg.workItemIdSource ?? 'workflow-input'} onChange={(e) => setCfg({ workItemIdSource: e.target.value as NodeRuntimeConfig['workItemIdSource'] })}>
              <option value="workflow-input">Workflow input</option>
              <option value="previous-node">Previous node</option>
              <option value="static">Static value</option>
            </select>
          </Field>
          {cfg.workItemIdSource === 'static' && (
            <input className="input text-xs" type="number" value={String(cfg.staticWorkItemId ?? '')} onChange={(e) => setCfg({ staticWorkItemId: Number(e.target.value) })} />
          )}
        </div>
      )}

      {(data.nodeType === 'ADO Upload' || agent?.type === 'ADO Upload') && (
        <div className="space-y-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/30 p-3">
          <p className="text-xs font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Azure DevOps upload</p>
          <Field label="Organization"><input className="input text-xs" value={cfg.adoOrg ?? ''} onChange={(e) => setCfg({ adoOrg: e.target.value })} /></Field>
          <Field label="Project"><input className="input text-xs" placeholder="auto from source work item" value={cfg.adoProject ?? ''} onChange={(e) => setCfg({ adoProject: e.target.value })} /></Field>
          <Field label="Work item type">
            <select className="input text-xs" value={cfg.adoWorkItemType ?? 'Test Case'} onChange={(e) => setCfg({ adoWorkItemType: e.target.value })}>
              <option>Test Case</option>
              <option>Bug</option>
              <option>Task</option>
              <option>User Story</option>
            </select>
          </Field>
          <Field label="Tags"><input className="input text-xs" value={cfg.adoTags ?? 'AI-Orchestration-Agent'} onChange={(e) => setCfg({ adoTags: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={cfg.linkToSource !== false} onChange={(e) => setCfg({ linkToSource: e.target.checked })} />
            Link to source work item
          </label>
        </div>
      )}
    </div>
  );
}

function ToolsTab({ agent, cfg, setCfg }: { agent: Agent | undefined; cfg: NodeRuntimeConfig; setCfg: (p: Partial<NodeRuntimeConfig>) => void }) {
  if (!agent) return <p className="text-xs text-slate-400">Bind an agent to manage tools.</p>;
  const enabled = new Set(cfg.enabledToolIds ?? agent.tools.filter((t) => t.enabled).map((t) => t.id));
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Tools enabled for this node. Library defaults are used until you toggle one.</p>
      {agent.tools.length === 0 && <p className="text-xs text-slate-400">No tools on this agent. Add them in the Agent Library.</p>}
      {agent.tools.map((t) => {
        const on = enabled.has(t.id);
        return (
          <label key={t.id} className="card p-3 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 cursor-pointer">
            <div>
              <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{t.name}</p>
              <p className="text-[11px] text-slate-400">{t.description || t.permissionLevel || 'tool'}</p>
            </div>
            <input
              type="checkbox"
              checked={on}
              onChange={() => {
                const next = new Set(enabled);
                if (on) next.delete(t.id); else next.add(t.id);
                setCfg({ enabledToolIds: [...next] });
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

function RuntimeTab({
  cfg, setCfg, notes, onNotes, nodeId, workflowId,
}: {
  cfg: NodeRuntimeConfig;
  setCfg: (p: Partial<NodeRuntimeConfig>) => void;
  notes: string;
  onNotes: (n: string) => void;
  nodeId: string;
  workflowId: string;
}) {
  const runs = useStore((s) => s.runs);
  const runningWorkflowId = useStore((s) => s.runningWorkflowId);
  const runStatus = useStore((s) => s.runStatus);
  const setPage = useStore((s) => s.setPage);
  const setSelectedRun = useStore((s) => s.setSelectedRun);

  const last = useMemo(() => {
    const relevant = runs
      .filter((r) => r.workflowId === workflowId)
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
    for (const run of relevant) {
      const exec = run.nodeExecutions?.find((ne) => ne.nodeId === nodeId);
      if (exec) return { run, exec };
    }
    return null;
  }, [runs, workflowId, nodeId]);

  const liveStatus = runningWorkflowId === workflowId ? runStatus[nodeId] : undefined;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Last run</p>
          {liveStatus && <StatusBadge status={liveStatus} />}
        </div>
        {!last && !liveStatus && (
          <p className="text-xs text-slate-400">No execution yet. Run this workflow to see input and output here.</p>
        )}
        {last && (
          <>
            <div className="flex items-center justify-between gap-2">
              <StatusBadge status={last.exec.status} />
              <span className="text-[11px] text-slate-400">
                {(last.exec.executionTimeMs / 1000).toFixed(1)}s · {last.exec.tokenUsage.toLocaleString()} tokens
              </span>
            </div>
            {last.exec.error && (
              <p className="text-[11px] font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">{last.exec.error}</p>
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Input</p>
              <pre className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-28 overflow-y-auto rounded bg-slate-50 dark:bg-slate-800/60 p-2">{last.exec.input || '—'}</pre>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Output</p>
              <pre className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto rounded bg-slate-50 dark:bg-slate-800/60 p-2">{last.exec.output || '—'}</pre>
            </div>
            <button
              type="button"
              className="btn-secondary text-xs w-full justify-center"
              onClick={() => { setSelectedRun(last.run.id); setPage('run-details'); }}
            >
              View run details <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
      <Field label="Timeout (s)">
        <input type="number" className="input" value={cfg.timeoutSec} onChange={(e) => setCfg({ timeoutSec: Number(e.target.value) })} />
      </Field>
      <Field label="Retry count">
        <input type="number" className="input" value={cfg.retryCount} onChange={(e) => setCfg({ retryCount: Number(e.target.value) })} />
      </Field>
      <Field label="Logging">
        <select className="input" value={cfg.loggingLevel} onChange={(e) => setCfg({ loggingLevel: e.target.value as NodeRuntimeConfig['loggingLevel'] })}>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
      </Field>
      <Field label="Notes">
        <textarea className="input min-h-16" value={notes} onChange={(e) => onNotes(e.target.value)} />
      </Field>
    </div>
  );
}

export function WorkflowSettingsPanel({
  name, description, triggerType, defaultInput, failurePolicy, maxExecutionTimeSec, onChange, onClose,
}: {
  name: string;
  description: string;
  triggerType: string;
  defaultInput: string;
  failurePolicy: string;
  maxExecutionTimeSec: number;
  onChange: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  return (
    <aside className="w-[22rem] shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="Settings" className="w-4 h-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Workflow</h3>
        </div>
        {onClose && <button onClick={onClose} className="btn-ghost p-1" aria-label="Close workflow settings"><X className="w-4 h-4" /></button>}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Field label="Name"><input className="input" value={name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
        <Field label="Description"><textarea className="input min-h-16" value={description} onChange={(e) => onChange({ description: e.target.value })} /></Field>
        <Field label="Trigger">
          <select className="input" value={triggerType} onChange={(e) => onChange({ triggerType: e.target.value })}>
            <option value="manual">Manual</option>
            <option value="scheduled">Scheduled</option>
            <option value="api">API</option>
            <option value="webhook">Webhook</option>
            <option value="azure-devops-workitem">Azure DevOps work item</option>
            <option value="github-pr">GitHub PR</option>
          </select>
        </Field>
        <Field label="Failure policy">
          <select className="input" value={failurePolicy} onChange={(e) => onChange({ failurePolicy: e.target.value })}>
            <option value="abort">Abort on failure</option>
            <option value="continue">Continue</option>
            <option value="retry">Retry node</option>
          </select>
        </Field>
        <Field label="Max execution time (s)">
          <input type="number" className="input" value={maxExecutionTimeSec} onChange={(e) => onChange({ maxExecutionTimeSec: Number(e.target.value) })} />
        </Field>
        <Field label="Default run input">
          <textarea className="input font-mono text-xs min-h-28" value={defaultInput} onChange={(e) => onChange({ defaultInput: e.target.value })} />
        </Field>
      </div>
    </aside>
  );
}
