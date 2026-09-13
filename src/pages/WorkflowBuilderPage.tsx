import { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, useReactFlow,
  addEdge, useNodesState, useEdgesState, type Connection, type Node,
  type Edge, BackgroundVariant, ConnectionMode, type NodeMouseHandler,
  type EdgeMouseHandler, type OnNodesChange, type OnEdgesChange,
  type FinalConnectionState, MarkerType, ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore, newAgentSkeleton, newWorkflowSkeleton } from '@/store';
import { StudioNode } from '@/components/StudioNode';
import { RunLivePanel } from '@/components/RunLivePanel';
import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import { NodeInspector, WorkflowSettingsPanel, defaultNodeConfig } from '@/components/NodeInspector';
import { DeployWorkflowModal } from '@/components/DeployWorkflowModal';
import { BRANCH_NODE_TYPES, sanitizeEdges } from '@/lib/graph';
import { isPublishedAgent } from '@/lib/agents';
import { canAccessEnvironment, envLabel } from '@/lib/environments';
import { canRole } from '@/lib/roles';
import {
  LIVE_CONTROL_PALETTE, LIVE_DATA_PALETTE, LIVE_INTEGRATION_PALETTE,
  STUB_CONTROL_PALETTE, STUB_DATA_PALETTE, STUB_INTEGRATION_PALETTE,
} from '@/lib/nodes';
import { fieldsFromInput, fieldsFromSchema, inputFromFields, type RunInputField } from '@/lib/runInput';
import { applyStudioDefaults, codeChangeIsLinked, USER_STORY_WORKFLOW_ID } from '@/lib/workflowSetup';
import {
  type WorkflowNodeData, type NodeKind, type WorkflowNode, type WorkflowEdge,
  type NodePaletteItem, type NodeRuntimeConfig,
} from '@/types';
import {
  Play, Save, Download, Upload, Copy, Lock, Undo2, Redo2,
  Plus, X, Search, CheckCircle2, AlertCircle, AlertTriangle,
  UserCheck, MousePointerClick, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, ArrowLeft, Rocket,
} from 'lucide-react';

const nodeTypes = { studioNode: StudioNode };

let nodeIdCounter = 1000;
function getNodeId() { return `n${++nodeIdCounter}`; }

const STATIC_PALETTE_GROUPS: { title: string; kind: NodeKind; items: NodePaletteItem[] }[] = [
  { title: 'Control', kind: 'control', items: LIVE_CONTROL_PALETTE },
  { title: 'Data', kind: 'data', items: LIVE_DATA_PALETTE },
  { title: 'Integrations', kind: 'integration', items: LIVE_INTEGRATION_PALETTE },
];
const STUB_PALETTE_GROUPS: { title: string; kind: NodeKind; items: NodePaletteItem[] }[] = [
  { title: 'Unavailable', kind: 'control', items: [...STUB_CONTROL_PALETTE, ...STUB_DATA_PALETTE, ...STUB_INTEGRATION_PALETTE] },
];

const AGENT_ICONS: Record<string, string> = {
  'Requirement Analysis': 'ClipboardList',
  'Test Case Generator': 'FileCheck',
  'Test Data Generator': 'Database',
  'Playwright Automation': 'MousePointerClick',
  'Code Review': 'GitPullRequest',
  'Code Change': 'Wrench',
  'Defect Analysis': 'Bug',
  'Report Generator': 'FileText',
  'Data Retrieval': 'Boxes',
  'ADO Upload': 'Upload',
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
  const environments = useStore((s) => s.environments);
  const currentUser = useStore((s) => s.currentUser);
  const setEnvironment = useStore((s) => s.setEnvironment);
  const canWriteWf = canRole(currentUser.role, 'workflows.write');
  const canRunWf = canRole(currentUser.role, 'workflows.run');
  const canApproveWf = canRole(currentUser.role, 'runs.approve');
  const canWriteAgents = canRole(currentUser.role, 'agents.write');
  const { screenToFlowPosition } = useReactFlow();

  const wf = workflows.find((w) => w.id === selectedWorkflowId) ?? workflows[0];
  const graphKey = wf
    ? `${wf.id}:${wf.updatedAt}:${wf.nodes.map((n) => n.id).join(',')}:${wf.edges.map((e) => `${e.source}->${e.target}`).join(',')}`
    : '';

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(wf?.nodes as unknown as Node[] ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(wf?.edges as unknown as Edge[] ?? []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [showRunModal, setShowRunModal] = useState(false);
  const [runInput, setRunInput] = useState('');
  const [runFields, setRunFields] = useState<RunInputField[]>([]);
  const [rawRunJson, setRawRunJson] = useState(false);
  const [showStubNodes, setShowStubNodes] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [history, setHistory] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [configs, setConfigs] = useState<Record<string, NodeConfig>>({});
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true); // builder side docks
  const [deployOpen, setDeployOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wf || wf.id !== USER_STORY_WORKFLOW_ID || codeChangeIsLinked(wf)) return;
    const next = applyStudioDefaults(wf);
    setWorkflowGraph(wf.id, next.nodes, next.edges);
  }, [wf, setWorkflowGraph]);

  useEffect(() => {
    if (wf?.environment && canAccessEnvironment(currentUser, wf.environment, environments)) {
      const current = useStore.getState().environment;
      if (current !== wf.environment) setEnvironment(wf.environment);
    }
  }, [wf?.environment, currentUser, environments, setEnvironment]);

  // Sync nodes/edges when workflow changes
  useEffect(() => {
    if (wf) {
      const n = wf.nodes as unknown as Node[];
      const e = sanitizeEdges(n, wf.edges as unknown as Edge[]);
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
  }, [graphKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update node status during and after a run
  useEffect(() => {
    if (!wf) return;
    if (runningWorkflowId === wf.id || Object.keys(runStatus).length > 0) {
      setNodes((nds) => nds.map((n) => {
        const rs = runStatus[n.id];
        if (rs) return { ...n, data: { ...n.data, status: rs } };
        return n;
      }));
    }
  }, [runStatus, runningWorkflowId, wf?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pendingApproval?.workflowId === wf?.id) {
      setSelectedNodeId(pendingApproval.nodeId);
    }
  }, [pendingApproval?.nodeId, pendingApproval?.workflowId, wf?.id]);

  const pushHistory = useCallback((n: Node[], e: Edge[]) => {
    setHistory((h) => {
      const newHist = h.slice(0, historyIdx + 1);
      newHist.push({ nodes: n, edges: e });
      return newHist;
    });
    setHistoryIdx((i) => i + 1);
  }, [historyIdx]);

  const makeConnection = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    setEdges((eds) => {
      const exists = eds.some((e) => (
        e.source === c.source
        && e.target === c.target
        && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)
      ));
      if (exists) return eds;
      const newEdges = addEdge({
        ...c,
        id: `e-${c.source}-${c.target}-${c.sourceHandle ?? 'out'}-${Date.now()}`,
        type: 'smoothstep',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#64748b' },
        style: { stroke: '#64748b', strokeWidth: 2 },
      }, eds);
      pushHistory(nodes, newEdges);
      return newEdges;
    });
  }, [nodes, setEdges, pushHistory]);

  const onConnect = useCallback((c: Connection) => {
    makeConnection(c);
  }, [makeConnection]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (!c.source || !c.target || c.source === c.target) return false;
    const src = nodes.find((n) => n.id === c.source);
    const tgt = nodes.find((n) => n.id === c.target);
    if (!src || !tgt) return false;
    const fromType = (src.data as WorkflowNodeData).nodeType;
    const toType = (tgt.data as WorkflowNodeData).nodeType;
    if (fromType === 'end' || toType === 'start') return false;
    return true;
  }, [nodes]);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (locked || state.isValid || !state.fromNode) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const flowPos = screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const hit = nodes.find((n) => {
      if (n.id === state.fromNode?.id) return false;
      const width = n.measured?.width ?? 220;
      const height = n.measured?.height ?? 88;
      return flowPos.x >= n.position.x
        && flowPos.x <= n.position.x + width
        && flowPos.y >= n.position.y
        && flowPos.y <= n.position.y + height;
    });
    if (!hit) return;
    const fromType = (state.fromNode.data as WorkflowNodeData).nodeType;
    const handle = state.fromHandle?.id
      ?? (BRANCH_NODE_TYPES.has(fromType) ? null : 'out');
    makeConnection({
      source: state.fromNode.id,
      target: hit.id,
      sourceHandle: handle,
      targetHandle: 'in',
    });
  }, [locked, nodes, screenToFlowPosition, makeConnection]);

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setRightOpen(true);
  }, []);

  const onEdgeClick: EdgeMouseHandler = useCallback((_, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setRightOpen(true);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!canWriteWf) return;
    const raw = e.dataTransfer.getData('application/reactflow') || e.dataTransfer.getData('text/plain');
    if (!raw || !wf) return;
    let item: NodePaletteItem;
    try {
      item = JSON.parse(raw) as NodePaletteItem;
    } catch {
      return;
    }
    if (item.kind === 'agent') {
      const agent = agents.find((a) => a.id === item.agentId);
      if (!agent || !isPublishedAgent(agent)) {
        addToast('Publish the agent before adding it to a workflow', 'error');
        return;
      }
    }
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
    setSelectedNodeId(newNode.id);
    setRightOpen(true);
    pushHistory(newNodes, edges);
  }, [nodes, edges, wf, agents, setNodes, setConfigs, pushHistory, screenToFlowPosition, addToast, canWriteWf]);

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

  const persistGraph = useCallback(() => {
    if (!wf) return;
    const nodesWithConfig = nodes.map((n) => {
      const d = n.data as WorkflowNodeData;
      return { ...n, data: { ...d, config: d.config ?? configs[n.id] ?? defaultConfig() } };
    });
    setWorkflowGraph(wf.id, nodesWithConfig as unknown as WorkflowNode[], edges as unknown as WorkflowEdge[]);
  }, [wf, nodes, edges, configs, setWorkflowGraph]);

  const handleSave = useCallback(() => {
    persistGraph();
    addToast('Workflow saved', 'success');
  }, [persistGraph, addToast]);

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
        const importedNodes = (data.nodes ?? []) as Node[];
        const importedEdges = sanitizeEdges(importedNodes, (data.edges ?? []) as Edge[]);
        if (data.nodes) setNodes(importedNodes);
        if (data.edges) setEdges(importedEdges);
        const cfgs: Record<string, NodeConfig> = {};
        importedNodes.forEach((node) => {
          const d = node.data as WorkflowNodeData;
          cfgs[node.id] = (d.config as unknown as NodeConfig) ?? defaultConfig();
        });
        setConfigs(cfgs);
        pushHistory(importedNodes, importedEdges);
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
      if (d.kind === 'agent' && d.agentId) {
        const bound = agents.find((a) => a.id === d.agentId);
        if (bound && !isPublishedAgent(bound)) errors.push(`Agent "${bound.displayName}" must be published before this workflow can run`);
      }
    });
    return errors;
  }, [nodes, edges, agents]);

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
    const payload = !rawRunJson && runFields.length ? inputFromFields(runFields, runInput) : runInput;
    startRun(wf.id, payload);
    addToast('Workflow execution started', 'success');
  }, [validateWorkflow, handleSave, startRun, wf, runInput, runFields, rawRunJson, addToast]);

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

  const isRunning = !!wf && runningWorkflowId === wf.id;
  const publishedAgents = agents.filter((a) => isPublishedAgent(a) && (!wf.environment || a.environment === wf.environment || !a.environment));
  const draftAgents = agents.filter((a) => a.persisted !== false && a.status !== 'published' && a.status !== 'archived' && (!wf.environment || a.environment === wf.environment || !a.environment));
  const agentPaletteItems: NodePaletteItem[] = publishedAgents.map((a) => ({
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

  if (!wf) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-slate-600 dark:text-slate-300">No workflow selected.</p>
          <button type="button" onClick={() => setPage('workflows')} className="btn-primary">Back to workflows</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPage('workflows')}
          className="btn-ghost p-2 shrink-0"
          title="Back to workflows"
          aria-label="Back to workflows"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
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
        <button onClick={() => canWriteWf && setLocked(!locked)} className={`btn-ghost p-2 shrink-0 ${locked || !canWriteWf ? 'text-amber-500' : ''}`} title="Lock editing" disabled={!canWriteWf}><Lock className="w-4 h-4" /></button>
        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />
        {canWriteWf && <button onClick={handleSave} className="btn-secondary text-sm shrink-0" title="Save (Ctrl+S)" aria-label="Save workflow"><Save className="w-4 h-4" /> Save</button>}
        <button onClick={handleExport} className="btn-secondary text-sm shrink-0"><Download className="w-4 h-4" /> Export</button>
        {canWriteWf && <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-sm shrink-0"><Upload className="w-4 h-4" /> Import</button>}
        <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileImport} className="hidden" />
        {canWriteWf && (
          <button onClick={() => {
            const created = newWorkflowSkeleton();
            createWorkflow(created);
            setSelectedWorkflow(created.id);
            addToast('New workflow created', 'success');
          }} className="btn-ghost p-2 shrink-0" title="New workflow"><Plus className="w-4 h-4" /></button>
        )}
        {canWriteWf && <button onClick={() => cloneWorkflow(wf.id)} className="btn-ghost p-2 shrink-0" title="Clone in this environment"><Copy className="w-4 h-4" /></button>}
        {canWriteWf && (
          <button
            onClick={() => { persistGraph(); setDeployOpen(true); }}
            className="btn-ghost p-2 shrink-0"
            title="Deploy to another environment"
          >
            <Rocket className="w-4 h-4" />
          </button>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {canApproveWf && pendingApproval && pendingApproval.workflowId === wf.id && (
            <>
              <span className="text-xs text-purple-600 dark:text-purple-300 truncate max-w-40">Approve: {pendingApproval.label}</span>
              <button onClick={() => approveRun()} className="btn-primary text-xs py-1.5"><UserCheck className="w-3.5 h-3.5" /> Approve</button>
              <button onClick={() => rejectRun()} className="btn-danger text-xs py-1.5">Reject</button>
            </>
          )}
          {validationErrors.length > 0 && (
            <span className="badge bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" /> {validationErrors.length} issues
            </span>
          )}
          {isRunning ? (
            canRunWf && <button onClick={cancelRun} className="btn-danger text-sm shrink-0" aria-label="Cancel run"><X className="w-4 h-4" /> Cancel Run</button>
          ) : (
            canRunWf && <button onClick={() => {
              const raw = wf.defaultInput && wf.defaultInput !== '{}' ? wf.defaultInput : '{\n  "workItemId": "",\n  "baseUrl": ""\n}';
              setRunInput(raw);
              const fields = fieldsFromSchema(wf.inputSchema, raw);
              setRunFields(fields);
              setRawRunJson(fields.length === 0);
              setShowRunModal(true);
            }} className="btn-primary text-sm shrink-0" aria-label="Open run workflow dialog"><Play className="w-4 h-4" /> Run Workflow</button>
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
            <button onClick={() => setValidationErrors([])} className="ml-auto btn-ghost p-1 text-red-500" aria-label="Dismiss validation errors"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left palette */}
        {!leftOpen ? (
          <aside className="w-10 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col items-center py-3">
            <button
              type="button"
              onClick={() => setLeftOpen(true)}
              className="btn-ghost p-2"
              aria-label="Expand node palette"
              title="Expand node palette"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </aside>
        ) : (
        <aside className="w-60 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="p-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex-1">Nodes</p>
              <button
                type="button"
                onClick={() => setLeftOpen(false)}
                className="btn-ghost p-1"
                aria-label="Collapse node palette"
                title="Collapse node palette"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Search nodes..."
                aria-label="Search nodes"
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                className="input pl-8 py-1.5 text-sm"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1">
              <MousePointerClick className="w-3 h-3" /> Drag a node onto the canvas
            </p>
            <label className="flex items-center gap-2 mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={showStubNodes} onChange={(e) => setShowStubNodes(e.target.checked)} />
              Show nodes that do not run yet
            </label>
            {canWriteAgents && (
              <button
                onClick={() => {
                  const created = newAgentSkeleton();
                  createAgent(created);
                  setSelectedAgent(created.id);
                  setPage('agent-config');
                  addToast('Untitled agent created — configure it, then drop it on the canvas', 'success');
                }}
                className="btn-secondary w-full mt-2 text-xs justify-center"
              >
                <Plus className="w-3.5 h-3.5" /> New agent
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {[{ title: 'Agents', kind: 'agent' as NodeKind, items: agentPaletteItems }, ...STATIC_PALETTE_GROUPS, ...(showStubNodes ? STUB_PALETTE_GROUPS : [])].map((group) => {
              const items = filteredPalette(group.items);
              if (items.length === 0) return null;
              return (
                <div key={group.title}>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">{group.title}</p>
                  <div className="space-y-1">
                    {items.map((item) => (
                      <div
                        key={`${item.type}-${item.agentId ?? item.label}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/reactflow', JSON.stringify(item));
                          e.dataTransfer.setData('text/plain', JSON.stringify(item));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 cursor-grab active:cursor-grabbing transition"
                        title="Drag onto the canvas"
                        role="option"
                        aria-label={`Drag ${item.label} onto canvas`}
                      >
                        <Icon name={item.icon} className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                      </div>
                    ))}
                    {group.title === 'Agents' && draftAgents.length > 0 && !paletteSearch && (
                      <p className="text-[10px] text-slate-400 pt-1">
                        {draftAgents.length} draft agent{draftAgents.length === 1 ? '' : 's'} hidden until published
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
        )}

        {/* Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrap}
            onEdgesChange={onEdgesChangeWrap}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={48}
            connectOnClick
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: '#3479f6', strokeWidth: 2 }}
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#64748b' },
              style: { stroke: '#64748b', strokeWidth: 2 },
            }}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            nodesDraggable={!locked && canWriteWf}
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
                if (d.status === 'waiting-approval') return '#a855f7';
                if (d.status === 'completed') return '#10b981';
                if (d.status === 'failed') return '#ef4444';
                return '#94a3b8';
              }}
              className="bg-white dark:bg-slate-900"
            />
          </ReactFlow>

          {/* Run overlay badge */}
          {isRunning && (
            <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-10 card px-4 py-2 flex items-center gap-2 ${pendingApproval ? 'bg-purple-50 dark:bg-purple-950 border-purple-300 dark:border-purple-700' : 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700'}`}>
              <div className={`w-2 h-2 rounded-full animate-pulse ${pendingApproval ? 'bg-purple-500' : 'bg-amber-500'}`} />
              <span className={`text-sm font-medium ${pendingApproval ? 'text-purple-700 dark:text-purple-300' : 'text-amber-700 dark:text-amber-300'}`}>
                {pendingApproval ? `Waiting for approval: ${pendingApproval.label}` : 'Executing workflow...'}
              </span>
            </div>
          )}

          <RunLivePanel workflowId={wf.id} selectedNodeId={selectedNodeId} />

          {/* Empty canvas hint */}
          {nodes.length <= 2 && !isRunning && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 card px-4 py-2 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur">
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Drag nodes from the left palette to build your workflow
              </p>
            </div>
          )}
        </div>

        {!rightOpen ? (
          <aside className="w-10 shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col items-center py-3">
            <button
              type="button"
              onClick={() => setRightOpen(true)}
              className="btn-ghost p-2"
              aria-label="Expand inspector"
              title="Expand inspector"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
          </aside>
        ) : selectedNode ? (
          <NodeInspector
            selectedNode={selectedNode}
            nodes={nodes}
            edges={edges}
            workflowId={wf.id}
            onUpdate={updateNodeData}
            onDuplicate={duplicateNode}
            onDelete={deleteNode}
            onClose={() => setSelectedNodeId(null)}
            onCollapse={() => setRightOpen(false)}
          />
        ) : selectedEdge ? (
          <aside className="w-[22rem] shrink-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Connection</h3>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setRightOpen(false)} className="btn-ghost p-1" aria-label="Collapse connection inspector">
                  <PanelRightClose className="w-4 h-4" />
                </button>
                <button onClick={() => setSelectedEdgeId(null)} className="btn-ghost p-1" aria-label="Close connection inspector"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="label" htmlFor="edge-from">From</label>
                <input id="edge-from" aria-label="From" className="input opacity-60" disabled value={nodes.find((n) => n.id === selectedEdge.source)?.data ? (nodes.find((n) => n.id === selectedEdge.source)?.data as WorkflowNodeData).label : ''} />
              </div>
              <div>
                <label className="label" htmlFor="edge-to">To</label>
                <input id="edge-to" aria-label="To" className="input opacity-60" disabled value={nodes.find((n) => n.id === selectedEdge.target)?.data ? (nodes.find((n) => n.id === selectedEdge.target)?.data as WorkflowNodeData).label : ''} />
              </div>
              <div>
                <label className="label" htmlFor="edge-label">Label</label>
                <input
                  id="edge-label"
                  aria-label="Label"
                  className="input"
                  placeholder="e.g. true / false / default"
                  value={String(selectedEdge.label ?? '')}
                  onChange={(e) => updateEdgeLabel(e.target.value)}
                />
              </div>
              <button onClick={deleteEdge} className="btn-danger text-sm w-full justify-center">Delete connection</button>
            </div>
          </aside>
        ) : (
          <WorkflowSettingsPanel
            name={wf.name}
            description={wf.description}
            triggerType={wf.triggerType}
            defaultInput={wf.defaultInput ?? '{}'}
            inputSchema={wf.inputSchema}
            versions={wf.versions}
            failurePolicy={wf.failurePolicy}
            maxExecutionTimeSec={wf.maxExecutionTimeSec}
            webhookSecret={wf.webhookSecret}
            scheduleCron={wf.scheduleCron}
            workflowId={wf.id}
            environment={wf.environment}
            onChange={(patch) => updateWorkflow(wf.id, patch as Partial<typeof wf>)}
            onCollapse={() => setRightOpen(false)}
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
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{envLabel(wf.environment, environments)}</p>
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
                <div className="flex items-center justify-between gap-2">
                  <label className="label" htmlFor="run-workflow-input">Workflow input</label>
                  {runFields.length > 0 && (
                    <button type="button" className="text-[11px] text-brand-600 dark:text-brand-400" onClick={() => setRawRunJson((v) => !v)}>
                      {rawRunJson ? 'Use form' : 'Edit JSON'}
                    </button>
                  )}
                </div>
                {!rawRunJson && runFields.length > 0 ? (
                  <div className="space-y-2">
                    {runFields.map((field, index) => (
                      <label key={field.key} className="block">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{field.key}</span>
                        {field.type === 'boolean' ? (
                          <select
                            className="input mt-1"
                            value={field.value}
                            onChange={(e) => setRunFields((prev) => prev.map((item, i) => i === index ? { ...item, value: e.target.value } : item))}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input
                            className="input mt-1"
                            type={field.type === 'number' ? 'number' : 'text'}
                            value={field.value}
                            onChange={(e) => setRunFields((prev) => prev.map((item, i) => i === index ? { ...item, value: e.target.value } : item))}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    className="input font-mono text-xs min-h-24"
                    value={runInput}
                    onChange={(e) => setRunInput(e.target.value)}
                    placeholder='{"workItemId": 123}'
                    aria-label="Workflow input JSON"
                    id="run-workflow-input"
                  />
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  {runFields.length ? 'Fields come from this workflow\'s default input.' : 'This workflow has no object-shaped default input, so JSON is used.'}
                </p>
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
              <button onClick={handleRun} className="btn-primary" aria-label="Confirm run workflow"><Play className="w-4 h-4" /> Run</button>
            </div>
          </div>
        </div>
      )}
      {deployOpen && wf && (
        <DeployWorkflowModal workflowId={wf.id} onClose={() => setDeployOpen(false)} />
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
