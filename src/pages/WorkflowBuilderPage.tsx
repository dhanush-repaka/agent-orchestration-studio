import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, useReactFlow,
  addEdge, useNodesState, useEdgesState, type Connection, type Node,
  type Edge, BackgroundVariant, ConnectionMode, type NodeMouseHandler,
  type EdgeMouseHandler, type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore, newAgentSkeleton, newWorkflowSkeleton } from '@/store';
import { StudioNode } from '@/components/StudioNode';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import { NodeInspector, WorkflowSettingsPanel, defaultNodeConfig } from '@/components/NodeInspector';
import {
  CONTROL_PALETTE, DATA_PALETTE, INTEGRATION_PALETTE,
  type WorkflowNodeData, type NodeKind, type WorkflowNode, type WorkflowEdge,
  type NodePaletteItem, type NodeRuntimeConfig,
} from '@/types';
import {
  Play, Save, Download, Upload, Copy, Lock, Undo2, Redo2,
  Plus, X, Search, CheckCircle2, AlertCircle, AlertTriangle,
  UserCheck, MousePointerClick,
} from 'lucide-react';

const nodeTypes = { studioNode: StudioNode };

let nodeIdCounter = 1000;
function getNodeId() { return `n${++nodeIdCounter}`; }

const STATIC_PALETTE_GROUPS: { title: string; kind: NodeKind; items: NodePaletteItem[] }[] = [
  { title: 'Control', kind: 'control', items: CONTROL_PALETTE },
  { title: 'Data', kind: 'data', items: DATA_PALETTE },
  { title: 'Integrations', kind: 'integration', items: INTEGRATION_PALETTE },
];

const AGENT_ICONS: Record<string, string> = {
  'Requirement Analysis': 'ClipboardList',
  'Test Case Generator': 'FileCheck',
  'Test Data Generator': 'Database',
  'Playwright Automation': 'MousePointerClick',
  'Code Review': 'GitPullRequest',
  'Defect Analysis': 'Bug',
  'Report Generator': 'FileText',
  'Data Retrieval': 'Boxes',
  'Root Cause Analysis': 'Activity',
  'Planner': 'ListChecks',
  'Research': 'Search',
  'Custom': 'Bot',
};

interface NodeConfig extends NodeRuntimeConfig {}

function defaultConfig(): NodeConfig {
  return defaultNodeConfig();
}

function BuilderInner() {
  const workflows = useStore((s) => s.workflows);
  const selectedWorkflowId = useStore((s) => s.selectedWorkflowId);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const setWorkflowGraph = useStore((s) => s.setWorkflowGraph);
  const cloneWorkflow = useStore((s) => s.cloneWorkflow);
  const createWorkflow = useStore((s) => s.createWorkflow);
  const updateWorkflow = useStore((s) => s.updateWorkflow);
  const createAgent = useStore((s) => s.createAgent);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const setPage = useStore((s) => s.setPage);
  const addToast = useStore((s) => s.addToast);
  const startRun = useStore((s) => s.startRun);
  const cancelRun = useStore((s) => s.cancelRun);
  const approveRun = useStore((s) => s.approveRun);
  const rejectRun = useStore((s) => s.rejectRun);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const runningWorkflowId = useStore((s) => s.runningWorkflowId);
  const runStatus = useStore((s) => s.runStatus);
  const agents = useStore((s) => s.agents);
  const { screenToFlowPosition } = useReactFlow();

  const wf = workflows.find((w) => w.id === selectedWorkflowId) ?? workflows[0];

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(wf?.nodes as unknown as Node[] ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(wf?.edges as unknown as Edge[] ?? []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [showRunModal, setShowRunModal] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [history, setHistory] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [configs, setConfigs] = useState<Record<string, NodeConfig>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Sync nodes/edges when workflow changes
  useEffect(() => {
    if (wf) {
      const n = wf.nodes as unknown as Node[];
      const e = wf.edges as unknown as Edge[];
      setNodes(n);
      setEdges(e);
      setHistory([{ nodes: n, edges: e }]);
      setHistoryIdx(0);
      const cfgs: Record<string, NodeConfig> = {};
      n.forEach((node) => {
        const d = node.data as WorkflowNodeData;
        cfgs[node.id] = (d.config as unknown as NodeConfig) ?? defaultConfig();
      });
      setConfigs(cfgs);
    }
  }, [wf?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update node status during run
  useEffect(() => {
    if (runningWorkflowId === wf?.id) {
      setNodes((nds) => nds.map((n) => {
        const rs = runStatus[n.id];
        if (rs) return { ...n, data: { ...n.data, status: rs } };
        return n;
      }));
    }
  }, [runStatus, runningWorkflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pushHistory = useCallback((n: Node[], e: Edge[]) => {
    setHistory((h) => {
      const newHist = h.slice(0, historyIdx + 1);
      newHist.push({ nodes: n, edges: e });
      return newHist;
    });
    setHistoryIdx((i) => i + 1);
  }, [historyIdx]);

  const onConnect = useCallback((c: Connection) => {
    setEdges((eds) => {
      const newEdges = addEdge({ ...c, animated: false }, eds);
      pushHistory(nodes, newEdges);
      return newEdges;
    });
  }, [nodes, setEdges, pushHistory]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick: EdgeMouseHandler = useCallback((_, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/reactflow');
    if (!raw || !wf) return;
    const item = JSON.parse(raw) as NodePaletteItem;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const matchingAgent = item.kind === 'agent'
      ? agents.find((a) => a.id === item.agentId)
      : undefined;
    const newNode: Node = {
      id: getNodeId(),
      type: 'studioNode',
      position,
      data: {
        kind: item.kind,
        nodeType: item.nodeType ?? item.type,
        label: matchingAgent?.displayName ?? item.label,
        agentType: matchingAgent?.type ?? item.agentType,
        agentId: matchingAgent?.id,
        icon: matchingAgent?.icon ?? item.icon,
        status: item.kind === 'agent' ? (matchingAgent ? 'ready' : 'not-configured') : 'ready',
        config: defaultConfig(),
      } as WorkflowNodeData,
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setConfigs((c) => ({ ...c, [newNode.id]: defaultConfig() }));
    pushHistory(newNodes, edges);
  }, [nodes, edges, wf, agents, setNodes, setConfigs, pushHistory, screenToFlowPosition]);

  // Click-to-add from palette
  const addNodeFromPalette = useCallback((item: NodePaletteItem) => {
    if (!wf) return;
    const position = { x: 200 + Math.random() * 100, y: 150 + Math.random() * 100 };
    const matchingAgent = item.kind === 'agent'
      ? agents.find((a) => a.id === item.agentId)
      : undefined;
    const newNode: Node = {
      id: getNodeId(),
      type: 'studioNode',
      position,
      data: {
        kind: item.kind,
        nodeType: item.nodeType ?? item.type,
        label: matchingAgent?.displayName ?? item.label,
        agentType: matchingAgent?.type ?? item.agentType,
        agentId: matchingAgent?.id,
        icon: matchingAgent?.icon ?? item.icon,
        status: item.kind === 'agent' ? (matchingAgent ? 'ready' : 'not-configured') : 'ready',
        config: defaultConfig(),
      } as WorkflowNodeData,
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setConfigs((c) => ({ ...c, [newNode.id]: defaultConfig() }));
    pushHistory(newNodes, edges);
  }, [nodes, edges, wf, agents, setNodes, setConfigs, pushHistory]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  const updateNodeData = useCallback((patch: Partial<WorkflowNodeData>) => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.map((n) => n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    if (patch.config) {
      setConfigs((c) => ({ ...c, [selectedNodeId]: { ...defaultConfig(), ...(patch.config as NodeConfig) } }));
    }
  }, [selectedNodeId, setNodes]);

  const deleteNode = useCallback(() => {
    if (!selectedNodeId) return;
    const newNodes = nodes.filter((n) => n.id !== selectedNodeId);
    const newEdges = edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
    setNodes(newNodes);
    setEdges(newEdges);
    setConfigs((c) => {
      const n = { ...c };
      delete n[selectedNodeId];
      return n;
    });
    setSelectedNodeId(null);
    pushHistory(newNodes, newEdges);
  }, [selectedNodeId, nodes, edges, setNodes, setEdges, setConfigs, pushHistory]);

  const duplicateNode = useCallback(() => {
    if (!selectedNode) return;
    const newNode: Node = {
      ...selectedNode,
      id: getNodeId(),
      position: { x: selectedNode.position.x + 60, y: selectedNode.position.y + 60 },
      selected: false,
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setConfigs((c) => ({ ...c, [newNode.id]: { ...c[selectedNode.id] } }));
    pushHistory(newNodes, edges);
  }, [selectedNode, nodes, setNodes, setConfigs, pushHistory]);

  const deleteEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    const newEdges = edges.filter((e) => e.id !== selectedEdgeId);
    setEdges(newEdges);
    setSelectedEdgeId(null);
    pushHistory(nodes, newEdges);
  }, [selectedEdgeId, edges, setEdges, pushHistory, nodes]);

  const updateEdgeLabel = useCallback((label: string) => {
    if (!selectedEdgeId) return;
    setEdges((eds) => eds.map((e) => e.id === selectedEdgeId ? { ...e, label } : e));
  }, [selectedEdgeId, setEdges]);

  const handleSave = useCallback(() => {
    if (!wf) return;
    const nodesWithConfig = nodes.map((n) => {
      const d = n.data as WorkflowNodeData;
      return { ...n, data: { ...d, config: d.config ?? configs[n.id] ?? defaultConfig() } };
    });
    setWorkflowGraph(wf.id, nodesWithConfig as unknown as WorkflowNode[], edges as unknown as WorkflowEdge[]);
    addToast('Workflow saved', 'success');
  }, [wf, nodes, edges, configs, setWorkflowGraph, addToast]);

  const handleExport = useCallback(() => {
    if (!wf) return;
    const exportData = { ...wf, nodes, edges };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wf.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('Workflow exported as JSON', 'success');
  }, [wf, nodes, edges, addToast]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.nodes) setNodes(data.nodes);
        if (data.edges) setEdges(data.edges);
        const cfgs: Record<string, NodeConfig> = {};
        (data.nodes as Node[]).forEach((node) => {
          const d = node.data as WorkflowNodeData;
          cfgs[node.id] = (d.config as unknown as NodeConfig) ?? defaultConfig();
        });
        setConfigs(cfgs);
        pushHistory(data.nodes ?? nodes, data.edges ?? edges);
        addToast('Workflow imported from file', 'success');
      } catch {
        addToast('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
  }, [nodes, edges, setNodes, setEdges, setConfigs, pushHistory, addToast]);

  const validateWorkflow = useCallback((): string[] => {
    const errors: string[] = [];
    if (!nodes.find((n) => (n.data as WorkflowNodeData).nodeType === 'start')) errors.push('Workflow has no Start node');
    if (!nodes.find((n) => (n.data as WorkflowNodeData).nodeType === 'end')) errors.push('Workflow has no End node');
    nodes.forEach((n) => {
      const d = n.data as WorkflowNodeData;
      if (d.nodeType !== 'end' && !edges.find((e) => e.source === n.id)) errors.push(`Node "${d.label}" has no outgoing connection`);
      if (d.nodeType !== 'start' && !edges.find((e) => e.target === n.id)) errors.push(`Node "${d.label}" has no incoming connection`);
      if (d.status === 'not-configured') errors.push(`Node "${d.label}" is not configured`);
      if (d.kind === 'agent' && !d.agentId) errors.push(`Node "${d.label}" has no agent bound`);
    });
    return errors;
  }, [nodes, edges]);

  const handleValidate = useCallback(() => {
    const errors = validateWorkflow();
    setValidationErrors(errors);
    if (errors.length === 0) addToast('Workflow is valid', 'success');
    else addToast(`${errors.length} validation issues found`, 'error');
  }, [validateWorkflow, addToast]);

  const handleRun = useCallback(() => {
    const errors = validateWorkflow();
    setValidationErrors(errors);
    if (errors.length > 0) {
      addToast('Fix validation errors before running', 'error');
      return;
    }
    handleSave();
    setShowRunModal(false);
    startRun(wf.id, runInput);
    addToast('Workflow execution started', 'success');
  }, [validateWorkflow, handleSave, startRun, wf, runInput, addToast]);

  const undo = useCallback(() => {
    if (historyIdx > 0) {
      const prev = history[historyIdx - 1];
      setNodes(prev.nodes);
      setEdges(prev.edges);
      setHistoryIdx(historyIdx - 1);
    }
  }, [historyIdx, history, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIdx < history.length - 1) {
      const next = history[historyIdx + 1];
      setNodes(next.nodes);
      setEdges(next.edges);
      setHistoryIdx(historyIdx + 1);
    }
  }, [historyIdx, history, setNodes, setEdges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) { e.preventDefault(); deleteNode(); }
        else if (selectedEdgeId) { e.preventDefault(); deleteEdge(); }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault(); undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault(); redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedNode) {
        e.preventDefault(); duplicateNode();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, selectedEdgeId, deleteNode, deleteEdge, undo, redo, handleSave, duplicateNode, selectedNode]);

  const onNodesChangeWrap: OnNodesChange = useCallback((changes) => {
    onNodesChange(changes);
  }, [onNodesChange]);

  const onEdgesChangeWrap: OnEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
  }, [onEdgesChange]);

  if (!wf) {
    return <div className="p-6 text-center text-slate-500">No workflow selected.</div>;
  }

  const isRunning = runningWorkflowId === wf.id;
  const agentPaletteItems: NodePaletteItem[] = agents.map((a) => ({
    type: 'agent',
    label: a.displayName,
    kind: 'agent',
    icon: AGENT_ICONS[a.type] ?? 'Bot',
    agentType: a.type,
    agentId: a.id,
    nodeType: a.type,
  }));
  const filteredPalette = (items: NodePaletteItem[]) => items.filter((i) => i.label.toLowerCase().includes(paletteSearch.toLowerCase()));
  const approvalNodes = nodes.filter((n) => (n.data as WorkflowNodeData).nodeType === 'approval');

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex items-center gap-2">
        <select
          value={wf.id}
          onChange={(e) => setSelectedWorkflow(e.target.value)}
          className="input w-auto text-sm font-medium shrink-0"
        >
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <div className="flex items-center gap-1.5 ml-1 shrink-0">
          <StatusBadge status={wf.published ? 'published' : 'draft'} />
          <span className="text-xs text-slate-500 dark:text-slate-400">v{wf.version}</span>
        </div>
        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />
        <button onClick={undo} disabled={historyIdx <= 0} className="btn-ghost p-2 shrink-0" title="Undo (Ctrl+Z)"><Undo2 className="w-4 h-4" /></button>
        <button onClick={redo} disabled={historyIdx >= history.length - 1} className="btn-ghost p-2 shrink-0" title="Redo (Ctrl+Y)"><Redo2 className="w-4 h-4" /></button>
        <button onClick={handleValidate} className="btn-ghost p-2 shrink-0" title="Validate"><CheckCircle2 className="w-4 h-4" /></button>
        <button onClick={() => setLocked(!locked)} className={`btn-ghost p-2 shrink-0 ${locked ? 'text-amber-500' : ''}`} title="Lock editing"><Lock className="w-4 h-4" /></button>
        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />
        <button onClick={handleSave} className="btn-secondary text-sm shrink-0" title="Save (Ctrl+S)"><Save className="w-4 h-4" /> Save</button>
        <button onClick={handleExport} className="btn-secondary text-sm shrink-0"><Download className="w-4 h-4" /> Export</button>
        <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-sm shrink-0"><Upload className="w-4 h-4" /> Import</button>
        <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileImport} className="hidden" />
        <button onClick={() => {
          const created = newWorkflowSkeleton();
          createWorkflow(created);
          setSelectedWorkflow(created.id);
          addToast('New workflow created', 'success');
        }} className="btn-ghost p-2 shrink-0" title="New workflow"><Plus className="w-4 h-4" /></button>
        <button onClick={() => cloneWorkflow(wf.id)} className="btn-ghost p-2 shrink-0" title="Clone"><Copy className="w-4 h-4" /></button>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {pendingApproval && pendingApproval.workflowId === wf.id && (
            <>
              <span className="text-xs text-purple-600 dark:text-purple-300 truncate max-w-40">Approve: {pendingApproval.label}</span>
              <button onClick={approveRun} className="btn-primary text-xs py-1.5"><UserCheck className="w-3.5 h-3.5" /> Approve</button>
              <button onClick={rejectRun} className="btn-danger text-xs py-1.5">Reject</button>
            </>
          )}
          {validationErrors.length > 0 && (
            <span className="badge bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" /> {validationErrors.length} issues
            </span>
          )}
          {isRunning ? (
            <button onClick={cancelRun} className="btn-danger text-sm shrink-0"><X className="w-4 h-4" /> Cancel Run</button>
          ) : (
            <button onClick={() => { setRunInput(wf.defaultInput && wf.defaultInput !== '{}' ? wf.defaultInput : '{\n  "workItemId": \n}'); setShowRunModal(true); }} className="btn-primary text-sm shrink-0"><Play className="w-4 h-4" /> Run Workflow</button>
          )}
        </div>
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="shrink-0 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 px-4 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <ul className="text-xs text-red-700 dark:text-red-300 space-y-0.5">
              {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
            <button onClick={() => setValidationErrors([])} className="ml-auto btn-ghost p-1 text-red-500"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left palette */}
        <aside className="w-60 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search nodes..."
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                className="input pl-8 py-1.5 text-sm"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
              <MousePointerClick className="w-3 h-3" /> Click or drag to add
            </p>
            <button
              onClick={() => {
                const created = newAgentSkeleton();
                createAgent(created);
                setSelectedAgent(created.id);
                setPage('agent-config');
                addToast('New agent created — configure it, then drop it on the canvas', 'success');
              }}
              className="btn-secondary w-full mt-2 text-xs justify-center"
            >
              <Plus className="w-3.5 h-3.5" /> New agent
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {[{ title: 'Agents', kind: 'agent' as NodeKind, items: agentPaletteItems }, ...STATIC_PALETTE_GROUPS].map((group) => {
              const items = filteredPalette(group.items);
              if (items.length === 0) return null;
              return (
                <div key={group.title}>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">{group.title}</p>
                  <div className="space-y-1">
                    {items.map((item) => (
                      <div
                        key={item.type + item.label}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('application/reactflow', JSON.stringify(item))}
                        onClick={() => addNodeFromPalette(item)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 cursor-grab active:cursor-grabbing transition"
                      >
                        <Icon name={item.icon} className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrap}
            onEdgesChange={onEdgesChangeWrap}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            nodesDraggable={!locked}
            nodesConnectable={!locked}
            elementsSelectable={!locked}
            deleteKeyCode={null}
            className="bg-slate-50 dark:bg-slate-950"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="bg-slate-50 dark:bg-slate-950" />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const d = n.data as WorkflowNodeData;
                if (d.status === 'running') return '#f59e0b';
                if (d.status === 'completed') return '#10b981';
                if (d.status === 'failed') return '#ef4444';
                return '#94a3b8';
              }}
              className="bg-white dark:bg-slate-900"
            />
          </ReactFlow>

          {/* Run overlay badge */}
          {isRunning && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 card px-4 py-2 flex items-center gap-2 bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                {pendingApproval ? `Waiting for approval: ${pendingApproval.label}` : 'Executing workflow...'}
              </span>
            </div>
          )}

          {/* Empty canvas hint */}
          {nodes.length <= 2 && !isRunning && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 card px-4 py-2 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur">
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Drag nodes from the left palette to build your workflow
              </p>
            </div>
          )}
        </div>

        {selectedNode && (
          <NodeInspector
            selectedNode={selectedNode}
            nodes={nodes}
            edges={edges}
            onUpdate={updateNodeData}
            onDuplicate={duplicateNode}
            onDelete={deleteNode}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {selectedEdge && !selectedNode && (
          <aside className="w-[22rem] shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Connection</h3>
              <button onClick={() => setSelectedEdgeId(null)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="label">From</label>
                <input className="input opacity-60" disabled value={nodes.find((n) => n.id === selectedEdge.source)?.data ? (nodes.find((n) => n.id === selectedEdge.source)?.data as WorkflowNodeData).label : ''} />
              </div>
              <div>
                <label className="label">To</label>
                <input className="input opacity-60" disabled value={nodes.find((n) => n.id === selectedEdge.target)?.data ? (nodes.find((n) => n.id === selectedEdge.target)?.data as WorkflowNodeData).label : ''} />
              </div>
              <div>
                <label className="label">Label</label>
                <input
                  className="input"
                  placeholder="e.g. true / false / default"
                  value={String(selectedEdge.label ?? '')}
                  onChange={(e) => updateEdgeLabel(e.target.value)}
                />
              </div>
              <button onClick={deleteEdge} className="btn-danger text-sm w-full justify-center">Delete connection</button>
            </div>
          </aside>
        )}

        {!selectedNode && !selectedEdge && (
          <WorkflowSettingsPanel
            name={wf.name}
            description={wf.description}
            triggerType={wf.triggerType}
            defaultInput={wf.defaultInput ?? '{}'}
            failurePolicy={wf.failurePolicy}
            maxExecutionTimeSec={wf.maxExecutionTimeSec}
            onChange={(patch) => updateWorkflow(wf.id, patch as Partial<typeof wf>)}
          />
        )}
      </div>

      {/* Run modal */}
      {showRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={() => setShowRunModal(false)}>
          <div className="card p-6 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Play className="w-5 h-5 text-brand-600" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Run Workflow</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">Review the execution details before running.</p>
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-xs text-slate-500">Workflow</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{wf.name}</p>
                </div>
                <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-xs text-slate-500">Environment</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white capitalize">{wf.environment}</p>
                </div>
                <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-xs text-slate-500">Nodes</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{nodes.length}</p>
                </div>
                <div className="card p-3 bg-slate-50 dark:bg-slate-800/50">
                  <p className="text-xs text-slate-500">Max Execution Time</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{wf.maxExecutionTimeSec}s</p>
                </div>
              </div>
              <div>
                <label className="label">Workflow Input</label>
                <textarea
                  className="input font-mono text-xs min-h-24"
                  value={runInput}
                  onChange={(e) => setRunInput(e.target.value)}
                  placeholder='{"workItemId": 123}'
                />
                <p className="text-[11px] text-slate-400 mt-1">Enter the runtime input values for this execution (JSON format)</p>
              </div>
              {approvalNodes.length > 0 && (
                <div className="card p-3 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Required Approvals</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Human Approval nodes will pause execution and notify approvers.</p>
                  <ul className="mt-2 space-y-1">
                    {approvalNodes.map((n) => (
                      <li key={n.id} className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                        <UserCheck className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{(n.data as WorkflowNodeData).label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRunModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleRun} className="btn-primary"><Play className="w-4 h-4" /> Run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowBuilderPage() {
  return (
    <ReactFlowProvider>
      <BuilderInner />
    </ReactFlowProvider>
  );
}
