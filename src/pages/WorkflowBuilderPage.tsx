import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, type Connection, type Node,
  type Edge, BackgroundVariant, ConnectionMode, type NodeMouseHandler,
  type EdgeMouseHandler, type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@/store';
import { StudioNode } from '@/components/StudioNode';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import {
  CONTROL_PALETTE, DATA_PALETTE, INTEGRATION_PALETTE,
  type WorkflowNodeData, type NodeKind, type WorkflowNode, type WorkflowEdge,
  type NodePaletteItem,
} from '@/types';
import {
  Play, Save, Download, Upload, Copy, Lock, Undo2, Redo2,
  Trash2, Plus, X, Search, CheckCircle2, AlertCircle, AlertTriangle,
  Settings2, UserCheck, MousePointerClick, Boxes,
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

interface NodeConfig {
  timeoutSec: number;
  retryCount: number;
  loggingLevel: string;
  inputMapping: string;
  outputMapping: string;
}

function defaultConfig(): NodeConfig {
  return { timeoutSec: 60, retryCount: 2, loggingLevel: 'info', inputMapping: '', outputMapping: '' };
}

function BuilderInner() {
  const workflows = useStore((s) => s.workflows);
  const selectedWorkflowId = useStore((s) => s.selectedWorkflowId);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const setWorkflowGraph = useStore((s) => s.setWorkflowGraph);
  const cloneWorkflow = useStore((s) => s.cloneWorkflow);
  const addToast = useStore((s) => s.addToast);
  const startRun = useStore((s) => s.startRun);
  const cancelRun = useStore((s) => s.cancelRun);
  const runningWorkflowId = useStore((s) => s.runningWorkflowId);
  const runStatus = useStore((s) => s.runStatus);
  const agents = useStore((s) => s.agents);

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
    const position = {
      x: e.clientX - (reactFlowWrapper.current?.getBoundingClientRect().left ?? 0) - 80,
      y: e.clientY - (reactFlowWrapper.current?.getBoundingClientRect().top ?? 0) - 20,
    };
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
        status: item.kind === 'agent' ? (matchingAgent ? 'ready' : 'not-configured') : 'ready',
        config: defaultConfig(),
      } as WorkflowNodeData,
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setConfigs((c) => ({ ...c, [newNode.id]: defaultConfig() }));
    pushHistory(newNodes, edges);
  }, [nodes, edges, wf, agents, setNodes, setConfigs, pushHistory]);

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
  }, [selectedNodeId, setNodes]);

  const updateConfig = useCallback((patch: Partial<NodeConfig>) => {
    if (!selectedNodeId) return;
    setConfigs((c) => ({ ...c, [selectedNodeId]: { ...c[selectedNodeId], ...patch } }));
    setNodes((nds) => nds.map((n) => {
      if (n.id !== selectedNodeId) return n;
      return { ...n, data: { ...n.data, config: { ...(n.data as WorkflowNodeData).config, ...patch } } };
    }));
  }, [selectedNodeId, setConfigs, setNodes]);

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
    const nodesWithConfig = nodes.map((n) => ({
      ...n,
      data: { ...n.data, config: configs[n.id] ?? defaultConfig() },
    }));
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
  const selectedConfig = selectedNodeId ? (configs[selectedNodeId] ?? defaultConfig()) : defaultConfig();

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
        <button onClick={() => cloneWorkflow(wf.id)} className="btn-ghost p-2 shrink-0" title="Clone"><Copy className="w-4 h-4" /></button>
        <div className="ml-auto flex items-center gap-2 shrink-0">
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
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Executing workflow...</span>
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

        {/* Right properties panel — Node */}
        {selectedNode && (
          <aside className="w-72 shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Node Properties</h3>
              </div>
              <button onClick={() => setSelectedNodeId(null)} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="label">Node Name</label>
                <input
                  className="input"
                  value={(selectedNode.data as WorkflowNodeData).label}
                  onChange={(e) => updateNodeData({ label: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Node Type</label>
                <input className="input opacity-60" disabled value={(selectedNode.data as WorkflowNodeData).nodeType} />
              </div>

              {(selectedNode.data as WorkflowNodeData).kind === 'agent' && (
                <>
                  <div>
                    <label className="label">Agent</label>
                    <select
                      className="input"
                      value={(selectedNode.data as WorkflowNodeData).agentId ?? ''}
                      onChange={(e) => {
                        const ag = agents.find((a) => a.id === e.target.value);
                        updateNodeData({ agentId: e.target.value, label: ag?.displayName ?? (selectedNode.data as WorkflowNodeData).label, status: 'ready' });
                      }}
                    >
                      <option value="">Select agent...</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const ag = agents.find((a) => a.id === (selectedNode.data as WorkflowNodeData).agentId);
                    if (!ag) return null;
                    return (
                      <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Description</p>
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{ag.description}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Model</p>
                            <p className="text-slate-700 dark:text-slate-200">{ag.modelProvider} / {ag.modelName}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Temperature</p>
                            <p className="text-slate-700 dark:text-slate-200">{ag.temperature}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Max Tokens</p>
                            <p className="text-slate-700 dark:text-slate-200">{ag.maxTokens}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Environment</p>
                            <p className="text-slate-700 dark:text-slate-200 capitalize">{ag.environment}</p>
                          </div>
                        </div>
                        {ag.tools.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Tools</p>
                            <div className="space-y-1">
                              {ag.tools.map((t) => (
                                <div key={t.id} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                                  <span className={`w-1.5 h-1.5 rounded-full ${t.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                                  <span className="font-medium">{t.name}</span>
                                  {t.permissionLevel && <span className="text-[10px] text-slate-400 capitalize">({t.permissionLevel})</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ag.inputs.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Inputs</p>
                            <div className="space-y-1">
                              {ag.inputs.map((inp) => (
                                <div key={inp.id} className="text-xs text-slate-600 dark:text-slate-300">
                                  <span className="font-medium">{inp.name}</span>
                                  <span className="text-slate-400"> · {inp.dataType}{inp.required ? ' · required' : ''}</span>
                                  {inp.description && <p className="text-[11px] text-slate-400 mt-0.5">{inp.description}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Output Format</p>
                          <p className="text-xs text-slate-600 dark:text-slate-300">
                            {ag.output.format}
                            {ag.output.requiredFields.length > 0 && <span className="text-slate-400"> · fields: {ag.output.requiredFields.join(', ')}</span>}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">System Prompt</p>
                          <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 max-h-32 overflow-y-auto">
                            <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{ag.prompt.systemPrompt}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-700">
                          <span>v{ag.version}</span>
                          <span>·</span>
                          <span>{ag.owner}</span>
                          <span>·</span>
                          <span className="capitalize">{ag.status}</span>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Agent-type-specific editable config */}
              {(() => {
                const d = selectedNode.data as WorkflowNodeData;
                if (d.kind !== 'agent') return null;
                const cfg = (d.config ?? {}) as Record<string, unknown>;
                const setCfg = (key: string, value: unknown) => updateNodeData({ config: { ...cfg, [key]: value } });

                // ADO Upload agent
                if (d.nodeType === 'ADO Upload') {
                  return (
                    <div className="space-y-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/30 p-3">
                      <p className="text-xs font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Azure DevOps Upload Settings</p>
                      <div>
                        <label className="label">ADO Organization</label>
                        <input className="input text-xs" placeholder="e.g. myorg" value={(cfg.adoOrg as string) ?? ''} onChange={(e) => setCfg('adoOrg', e.target.value)} />
                        <p className="text-[11px] text-slate-400 mt-1">Your Azure DevOps org name (from dev.azure.com/<b>org</b>)</p>
                      </div>
                      <div>
                        <label className="label">ADO Project</label>
                        <input className="input text-xs" placeholder="Auto-detected from source work item" value={(cfg.adoProject as string) ?? ''} onChange={(e) => setCfg('adoProject', e.target.value)} />
                        <p className="text-[11px] text-slate-400 mt-1">Leave blank to auto-detect from the source work item's Area Path</p>
                      </div>
                      <div>
                        <label className="label">API Version</label>
                        <input className="input text-xs" placeholder="7.0" value={(cfg.adoApiVersion as string) ?? '7.0'} onChange={(e) => setCfg('adoApiVersion', e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Work Item Type</label>
                        <select className="input text-xs" value={(cfg.adoWorkItemType as string) ?? 'Test Case'} onChange={(e) => setCfg('adoWorkItemType', e.target.value)}>
                          <option value="Test Case">Test Case</option>
                          <option value="Bug">Bug</option>
                          <option value="Task">Task</option>
                          <option value="User Story">User Story</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Tags</label>
                        <input className="input text-xs" placeholder="AI-Orchestration-Agent" value={(cfg.adoTags as string) ?? 'AI-Orchestration-Agent'} onChange={(e) => setCfg('adoTags', e.target.value)} />
                        <p className="text-[11px] text-slate-400 mt-1">Comma-separated tags applied to each created work item</p>
                      </div>
                      <div>
                        <label className="label">Priority Mapping</label>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {(['critical', 'high', 'medium', 'low'] as const).map((p) => (
                            <div key={p} className="flex items-center gap-1.5">
                              <span className="capitalize text-slate-500 w-16">{p}</span>
                              <input type="number" min={1} max={4} className="input text-xs py-1" value={String((cfg.priorityMap as Record<string, number>)?.[p] ?? { critical: 1, high: 2, medium: 3, low: 4 }[p])} onChange={(e) => setCfg('priorityMap', { ...((cfg.priorityMap as Record<string, number>) ?? { critical: 1, high: 2, medium: 3, low: 4 }), [p]: Number(e.target.value) })} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input type="checkbox" className="rounded border-slate-300" checked={cfg.linkToSource !== false} onChange={(e) => setCfg('linkToSource', e.target.checked)} />
                        Link test cases to source work item
                      </label>
                    </div>
                  );
                }

                // Data Retrieval agent
                if (d.nodeType === 'Data Retrieval') {
                  return (
                    <div className="space-y-3 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/30 p-3">
                      <p className="text-xs font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Azure DevOps Retrieval Settings</p>
                      <div>
                        <label className="label">ADO Organization</label>
                        <input className="input text-xs" placeholder="e.g. myorg" value={(cfg.adoOrg as string) ?? ''} onChange={(e) => setCfg('adoOrg', e.target.value)} />
                        <p className="text-[11px] text-slate-400 mt-1">Your Azure DevOps org name (from dev.azure.com/<b>org</b>)</p>
                      </div>
                      <div>
                        <label className="label">API Version</label>
                        <input className="input text-xs" placeholder="7.0" value={(cfg.adoApiVersion as string) ?? '7.0'} onChange={(e) => setCfg('adoApiVersion', e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Work Item ID Source</label>
                        <select className="input text-xs" value={(cfg.workItemIdSource as string) ?? 'workflow-input'} onChange={(e) => setCfg('workItemIdSource', e.target.value)}>
                          <option value="workflow-input">From workflow input</option>
                          <option value="previous-node">From previous node output</option>
                          <option value="static">Static value</option>
                        </select>
                        {cfg.workItemIdSource === 'static' && (
                          <input className="input text-xs mt-2" type="number" placeholder="Enter work item ID" value={String(cfg.staticWorkItemId ?? '')} onChange={(e) => setCfg('staticWorkItemId', Number(e.target.value))} />
                        )}
                      </div>
                      <div>
                        <label className="label">Fields to Retrieve</label>
                        <textarea className="input text-xs font-mono min-h-16" placeholder="System.Title, System.Description, System.State, Microsoft.VSTS.Common.AcceptanceCriteria" value={(cfg.adoFields as string) ?? ''} onChange={(e) => setCfg('adoFields', e.target.value)} />
                        <p className="text-[11px] text-slate-400 mt-1">Comma-separated list of ADO fields to fetch. Leave blank for default set.</p>
                      </div>
                    </div>
                  );
                }

                // Generic agent model settings (editable)
                const ag = agents.find((a) => a.id === d.agentId);
                if (!ag) return null;
                return (
                  <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5" /> Model Settings</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label">Temperature</label>
                        <input type="number" step="0.1" min={0} max={2} className="input text-xs" value={String((cfg.temperature as number) ?? ag.temperature)} onChange={(e) => setCfg('temperature', Number(e.target.value))} />
                      </div>
                      <div>
                        <label className="label">Max Tokens</label>
                        <input type="number" className="input text-xs" value={String((cfg.maxTokens as number) ?? ag.maxTokens)} onChange={(e) => setCfg('maxTokens', Number(e.target.value))} />
                      </div>
                      <div>
                        <label className="label">Top P</label>
                        <input type="number" step="0.05" min={0} max={1} className="input text-xs" value={String((cfg.topP as number) ?? ag.topP)} onChange={(e) => setCfg('topP', Number(e.target.value))} />
                      </div>
                      <div>
                        <label className="label">Freq. Penalty</label>
                        <input type="number" step="0.1" min={-2} max={2} className="input text-xs" value={String((cfg.frequencyPenalty as number) ?? ag.frequencyPenalty)} onChange={(e) => setCfg('frequencyPenalty', Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="label">Status</label>
                <select
                  className="input"
                  value={(selectedNode.data as WorkflowNodeData).status}
                  onChange={(e) => updateNodeData({ status: e.target.value as WorkflowNodeData['status'] })}
                >
                  <option value="not-configured">Not Configured</option>
                  <option value="ready">Ready</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="skipped">Skipped</option>
                </select>
              </div>

              {(selectedNode.data as WorkflowNodeData).nodeType === 'condition' && (
                <div>
                  <label className="label">Condition Expression</label>
                  <input
                    className="input font-mono text-xs"
                    placeholder="{{nodes.X.output.qualityScore}} >= 70"
                    value={((selectedNode.data as WorkflowNodeData).config?.expression as string) ?? ''}
                    onChange={(e) => updateNodeData({ config: { ...(selectedNode.data as WorkflowNodeData).config, expression: e.target.value } })}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">True → top output, False → bottom output</p>
                </div>
              )}

              {(selectedNode.data as WorkflowNodeData).nodeType === 'wait' && (
                <div>
                  <label className="label">Wait Duration (ms)</label>
                  <input
                    type="number"
                    className="input"
                    value={((selectedNode.data as WorkflowNodeData).config?.duration as number) ?? 5000}
                    onChange={(e) => updateNodeData({ config: { ...(selectedNode.data as WorkflowNodeData).config, duration: Number(e.target.value) } })}
                  />
                </div>
              )}

              {(selectedNode.data as WorkflowNodeData).nodeType === 'loop' && (
                <div>
                  <label className="label">Loop Count</label>
                  <input
                    type="number"
                    className="input"
                    value={((selectedNode.data as WorkflowNodeData).config?.loopCount as number) ?? 3}
                    onChange={(e) => updateNodeData({ config: { ...(selectedNode.data as WorkflowNodeData).config, loopCount: Number(e.target.value) } })}
                  />
                </div>
              )}

              {(selectedNode.data as WorkflowNodeData).nodeType === 'approval' && (
                <div>
                  <label className="label">Approver</label>
                  <input
                    className="input"
                    placeholder="Enter approver name or email"
                    value={((selectedNode.data as WorkflowNodeData).config?.approver as string) ?? ''}
                    onChange={(e) => updateNodeData({ config: { ...(selectedNode.data as WorkflowNodeData).config, approver: e.target.value } })}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Execution pauses until this person approves</p>
                </div>
              )}

              <div>
                <label className="label">Timeout (s)</label>
                <input
                  type="number"
                  className="input"
                  value={selectedConfig.timeoutSec}
                  onChange={(e) => updateConfig({ timeoutSec: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Retry Count</label>
                <input
                  type="number"
                  className="input"
                  value={selectedConfig.retryCount}
                  onChange={(e) => updateConfig({ retryCount: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Logging Level</label>
                <select
                  className="input"
                  value={selectedConfig.loggingLevel}
                  onChange={(e) => updateConfig({ loggingLevel: e.target.value })}
                >
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
              </div>

              <div>
                <label className="label">Input Mapping</label>
                <textarea
                  className="input font-mono text-xs min-h-20"
                  placeholder="{{nodes.previous.output}}"
                  value={selectedConfig.inputMapping}
                  onChange={(e) => updateConfig({ inputMapping: e.target.value })}
                />
                <p className="text-[11px] text-slate-400 mt-1">Map previous output to this node's input</p>
              </div>

              <div>
                <label className="label">Output Mapping</label>
                <textarea
                  className="input font-mono text-xs min-h-20"
                  placeholder="{{this.output}}"
                  value={selectedConfig.outputMapping}
                  onChange={(e) => updateConfig({ outputMapping: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input min-h-16"
                  placeholder="Add notes for this node..."
                  value={(selectedNode.data as WorkflowNodeData).notes ?? ''}
                  onChange={(e) => updateNodeData({ notes: e.target.value })}
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button onClick={duplicateNode} className="btn-secondary text-sm flex-1 justify-center" title="Duplicate (Ctrl+D)"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
                <button onClick={deleteNode} className="btn-danger text-sm" title="Delete (Del)"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </aside>
        )}

        {/* Right properties panel — Edge */}
        {selectedEdge && !selectedNode && (
          <aside className="w-72 shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Connection</h3>
              </div>
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
                  value={selectedEdge.label ?? ''}
                  onChange={(e) => updateEdgeLabel(e.target.value)}
                />
                <p className="text-[11px] text-slate-400 mt-1">Shown on the connection line</p>
              </div>
              <button onClick={deleteEdge} className="btn-danger text-sm w-full justify-center"><Trash2 className="w-3.5 h-3.5" /> Delete Connection</button>
            </div>
          </aside>
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
