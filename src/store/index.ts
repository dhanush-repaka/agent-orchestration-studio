import { create } from 'zustand';
import { executeWorkflow } from '@/lib/engine';
import type {
  Agent, Workflow, WorkflowRun, Environment, NodeStatus,
  WorkflowNode, WorkflowEdge,
} from '@/types';
import {
  AGENTS, WORKFLOWS, WORKFLOW_RUNS, PROMPTS, CREDENTIALS,
  INTEGRATIONS, EVALUATIONS, AUDIT_LOGS, USERS, CURRENT_USER,
} from '@/data/mock';
import { supabase } from '@/lib/supabase';
import { syncPageToUrl, pageFromPath } from '@/lib/routes';
import { sanitizeWorkflowGraph } from '@/lib/graph';

async function persistRun(run: WorkflowRun) {
  const { error } = await supabase
    .from('workflow_runs')
    .upsert({ id: run.id, data: run, updated_at: new Date().toISOString() });
  if (error) console.error('Failed to persist run:', error.message);
}

export async function loadRunsFromDb(): Promise<WorkflowRun[]> {
  try {
    const { data, error } = await supabase.from('workflow_runs').select('data');
    if (error) {
      console.error('Failed to load runs:', error.message);
      return [];
    }
    return (data ?? []).map((row) => row.data as WorkflowRun);
  } catch (err) {
    console.error('Failed to load runs:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function persistAgent(agent: Agent) {
  const { error } = await supabase
    .from('agents')
    .upsert({ id: agent.id, data: agent, updated_at: new Date().toISOString() });
  if (error) console.error('Failed to persist agent:', error.message);
}

async function deleteAgentFromDb(id: string) {
  const { error } = await supabase.from('agents').delete().eq('id', id);
  if (error) console.error('Failed to delete agent:', error.message);
}

function isUntitledSkeleton(a: Agent): boolean {
  return (
    a.name === 'new-agent' &&
    (a.displayName === 'New Agent' || !a.displayName?.trim()) &&
    !a.description?.trim() &&
    !a.prompt?.systemPrompt?.trim() &&
    !a.prompt?.userPromptTemplate?.trim() &&
    (a.inputs?.length ?? 0) === 0
  );
}

export async function loadAgentsFromDb(): Promise<Agent[]> {
  try {
    const { data, error } = await supabase.from('agents').select('data');
    if (error) {
      console.error('Failed to load agents:', error.message);
      return [];
    }
    return (data ?? []).map((row) => row.data as Agent);
  } catch (err) {
    console.error('Failed to load agents:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function persistWorkflow(wf: Workflow) {
  const { error } = await supabase
    .from('workflows')
    .upsert({ id: wf.id, data: wf, updated_at: new Date().toISOString() });
  if (error) console.error('Failed to persist workflow:', error.message);
}

async function deleteWorkflowFromDb(id: string) {
  const { error } = await supabase.from('workflows').delete().eq('id', id);
  if (error) console.error('Failed to delete workflow:', error.message);
}

export async function loadWorkflowsFromDb(): Promise<Workflow[]> {
  try {
    const { data, error } = await supabase.from('workflows').select('data');
    if (error) {
      console.error('Failed to load workflows:', error.message);
      return [];
    }
    return (data ?? []).map((row) => row.data as Workflow);
  } catch (err) {
    console.error('Failed to load workflows:', err instanceof Error ? err.message : err);
    return [];
  }
}

export type Page =
  | 'dashboard'
  | 'agents'
  | 'agent-config'
  | 'workflow-builder'
  | 'workflow-runs'
  | 'run-details'
  | 'tools'
  | 'prompts'
  | 'knowledge'
  | 'models'
  | 'credentials'
  | 'evaluations'
  | 'monitoring'
  | 'audit'
  | 'settings';

export type Theme = 'light' | 'dark';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AppState {
  // navigation
  page: Page;
  setPage: (p: Page) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  theme: Theme;
  toggleTheme: () => void;
  environment: Environment;
  setEnvironment: (e: Environment) => void;

  // data
  agents: Agent[];
  workflows: Workflow[];
  runs: WorkflowRun[];
  prompts: typeof PROMPTS;
  credentials: typeof CREDENTIALS;
  integrations: typeof INTEGRATIONS;
  evaluations: typeof EVALUATIONS;
  auditLogs: typeof AUDIT_LOGS;
  users: typeof USERS;
  currentUser: typeof CURRENT_USER;

  // selection
  selectedAgentId: string | null;
  selectedWorkflowId: string | null;
  selectedRunId: string | null;
  setSelectedAgent: (id: string | null) => void;
  setSelectedWorkflow: (id: string | null) => void;
  setSelectedRun: (id: string | null) => void;

  // agent CRUD
  createAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  deleteAgent: (id: string) => void;
  cloneAgent: (id: string) => void;

  // credential CRUD
  updateCredential: (id: string, patch: Partial<typeof CREDENTIALS[number]>) => void;

  // user CRUD
  updateUser: (id: string, patch: Partial<typeof USERS[number]>) => void;

  // workflow CRUD
  createWorkflow: (wf: Workflow) => void;
  updateWorkflow: (id: string, patch: Partial<Workflow>) => void;
  deleteWorkflow: (id: string) => void;
  cloneWorkflow: (id: string) => void;
  setWorkflowGraph: (id: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;

  // execution
  runningWorkflowId: string | null;
  runStatus: Record<string, NodeStatus>;
  pendingApproval: { workflowId: string; nodeId: string; label: string } | null;
  startRun: (workflowId: string, runtimeInput?: string) => void;
  cancelRun: () => void;
  approveRun: () => void;
  rejectRun: () => void;
  runNodeStatus: (workflowId: string, nodeId: string) => NodeStatus | undefined;

  // toasts
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
  hydrateAgents: () => Promise<void>;
  hydrateWorkflows: () => Promise<void>;
  hydrateRuns: () => Promise<void>;
}

let toastId = 0;
let agentIdCounter = 100;
let wfIdCounter = 100;
let runGeneration = 0;
let approvalWait: { resolve: (ok: boolean) => void } | null = null;

function maxNumericId(prefix: string, ids: string[], fallback: number): number {
  let max = fallback;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function uniquePrefixedId(prefix: 'a' | 'w', taken: Iterable<string>): string {
  const set = new Set(taken);
  if (prefix === 'a') agentIdCounter = maxNumericId('a', [...set], agentIdCounter);
  else wfIdCounter = maxNumericId('w', [...set], wfIdCounter);
  let id = prefix === 'a' ? `a${++agentIdCounter}` : `w${++wfIdCounter}`;
  while (set.has(id)) {
    id = prefix === 'a' ? `a${++agentIdCounter}` : `w${++wfIdCounter}`;
  }
  return id;
}

export const useStore = create<AppState>((set, get) => ({
  page: typeof window !== 'undefined' ? pageFromPath(window.location.pathname) : 'dashboard',
  setPage: (p) => {
    const s = get();
    if (s.page === 'agent-config' && p !== 'agent-config') {
      const agent = s.agents.find((a) => a.id === s.selectedAgentId);
      if (agent?.persisted === false) {
        deleteAgentFromDb(agent.id);
        set({
          page: p,
          agents: s.agents.filter((a) => a.id !== agent.id),
          selectedAgentId: s.selectedAgentId === agent.id ? null : s.selectedAgentId,
        });
        syncPageToUrl(p);
        return;
      }
    }
    set({ page: p });
    syncPageToUrl(p);
  },
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  theme: 'light',
  toggleTheme: () => set((s) => {
    const next = s.theme === 'light' ? 'dark' : 'light';
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', next === 'dark');
    }
    return { theme: next };
  }),
  environment: 'production',
  setEnvironment: (e) => set({ environment: e }),

  agents: AGENTS,
  workflows: WORKFLOWS,
  runs: WORKFLOW_RUNS,
  prompts: PROMPTS,
  credentials: CREDENTIALS,
  integrations: INTEGRATIONS,
  evaluations: EVALUATIONS,
  auditLogs: AUDIT_LOGS,
  users: USERS,
  currentUser: CURRENT_USER,

  selectedAgentId: null,
  selectedWorkflowId: 'w1',
  selectedRunId: null,
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  setSelectedWorkflow: (id) => set({ selectedWorkflowId: id }),
  setSelectedRun: (id) => set({ selectedRunId: id }),

  createAgent: (agent) => {
    const id = get().agents.some((a) => a.id === agent.id)
      ? uniquePrefixedId('a', get().agents.map((a) => a.id))
      : agent.id;
    agent.id = id;
    const next = { ...agent, persisted: agent.persisted ?? false };
    set((s) => ({ agents: [next, ...s.agents] }));
    if (next.persisted !== false) persistAgent({ ...next, persisted: true });
  },
  updateAgent: (id, patch) => {
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch, persisted: true, updatedAt: new Date().toISOString() } : a)),
    }));
    const updated = get().agents.find((a) => a.id === id);
    if (updated) persistAgent(updated);
  },
  deleteAgent: (id) => {
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
    deleteAgentFromDb(id);
  },
  cloneAgent: (id) => {
    const agent = get().agents.find((a) => a.id === id);
    if (!agent) return;
    const newId = uniquePrefixedId('a', get().agents.map((a) => a.id));
    const clone: Agent = {
      ...agent,
      id: newId,
      name: `${agent.name}-copy`,
      displayName: `${agent.displayName} (Copy)`,
      status: 'draft',
      version: '0.1.0',
      workflowsUsing: 0,
      persisted: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ agents: [clone, ...s.agents] }));
    persistAgent(clone);
    get().addToast(`Cloned agent: ${agent.displayName}`, 'success');
  },

  updateCredential: (id, patch) => set((s) => ({
    credentials: s.credentials.map((c) => (c.id === id ? { ...c, ...patch, lastRotatedAt: new Date().toISOString() } : c)),
  })),

  updateUser: (id, patch) => set((s) => ({
    users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
  })),

  createWorkflow: (wf) => {
    const id = get().workflows.some((w) => w.id === wf.id)
      ? uniquePrefixedId('w', get().workflows.map((w) => w.id))
      : wf.id;
    wf.id = id;
    const next = { ...wf, id };
    set((s) => ({ workflows: [next, ...s.workflows], selectedWorkflowId: id }));
    persistWorkflow(next);
  },
  updateWorkflow: (id, patch) => {
    set((s) => ({
      workflows: s.workflows.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: new Date().toISOString() } : w)),
    }));
    const updated = get().workflows.find((w) => w.id === id);
    if (updated) persistWorkflow(updated);
  },
  deleteWorkflow: (id) => {
    set((s) => ({ workflows: s.workflows.filter((w) => w.id !== id) }));
    deleteWorkflowFromDb(id);
  },
  cloneWorkflow: (id) => {
    const wf = get().workflows.find((w) => w.id === id);
    if (!wf) return;
    const newId = uniquePrefixedId('w', get().workflows.map((w) => w.id));
    const clone: Workflow = {
      ...wf,
      id: newId,
      name: `${wf.name} (Copy)`,
      published: false,
      version: '0.1.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ workflows: [clone, ...s.workflows] }));
    persistWorkflow(clone);
    get().addToast(`Cloned workflow: ${wf.name}`, 'success');
  },
  setWorkflowGraph: (id, nodes, edges) => {
    const cleanEdges = sanitizeWorkflowGraph(nodes, edges);
    const boundIds = new Set(nodes.map((n) => n.data.agentId).filter(Boolean) as string[]);
    const unsavedBound = get().agents.filter((a) => boundIds.has(a.id) && a.persisted === false);
    set((s) => ({
      agents: unsavedBound.length
        ? s.agents.map((a) => (boundIds.has(a.id) && a.persisted === false ? { ...a, persisted: true } : a))
        : s.agents,
      workflows: s.workflows.map((w) => (w.id === id ? { ...w, nodes, edges: cleanEdges, updatedAt: new Date().toISOString() } : w)),
    }));
    const updated = get().workflows.find((w) => w.id === id);
    if (updated) persistWorkflow(updated);
    unsavedBound.forEach((a) => persistAgent({ ...a, persisted: true }));
  },

  runningWorkflowId: null,
  runStatus: {},
  pendingApproval: null,
  startRun: (workflowId, runtimeInput) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    const statusMap: Record<string, NodeStatus> = {};
    wf.nodes.forEach((n) => { statusMap[n.id] = 'ready'; });
    runGeneration += 1;
    const gen = runGeneration;
    approvalWait = null;
    set({ runningWorkflowId: workflowId, runStatus: statusMap, pendingApproval: null });

    void executeWorkflow({
      workflow: wf,
      agents: get().agents,
      runtimeInput,
      triggeredBy: get().currentUser.name,
      callbacks: {
        isCancelled: () => get().runningWorkflowId !== workflowId || gen !== runGeneration,
        onNodeStatus: (nodeId, status) => {
          set((s) => ({ runStatus: { ...s.runStatus, [nodeId]: status } }));
        },
        waitForApproval: (nodeId, label) => new Promise<boolean>((resolve) => {
          approvalWait = { resolve };
          set({ pendingApproval: { workflowId, nodeId, label } });
          get().addToast(`Waiting for approval: ${label}`, 'info');
        }),
      },
    }).then((run) => {
      if (gen !== runGeneration) return;
      set((s) => ({
        runningWorkflowId: null,
        pendingApproval: null,
        runs: [run, ...s.runs],
      }));
      persistRun(run);
      const ok = run.status === 'completed';
      get().addToast(`Workflow ${run.status}`, ok ? 'success' : run.status === 'cancelled' ? 'info' : 'error');
    }).catch((err) => {
      if (gen !== runGeneration) return;
      set({ runningWorkflowId: null, pendingApproval: null });
      get().addToast(err instanceof Error ? err.message : 'Workflow failed', 'error');
    });
  },
    cancelRun: () => {
    runGeneration += 1;
    approvalWait?.resolve(false);
    approvalWait = null;
    set({ runningWorkflowId: null, runStatus: {}, pendingApproval: null });
    get().addToast('Workflow execution cancelled', 'info');
  },
  approveRun: () => {
    approvalWait?.resolve(true);
    approvalWait = null;
    set({ pendingApproval: null });
    get().addToast('Approval granted', 'success');
  },
  rejectRun: () => {
    approvalWait?.resolve(false);
    approvalWait = null;
    set({ pendingApproval: null });
    get().addToast('Approval rejected', 'error');
  },
  runNodeStatus: (workflowId, nodeId) => {
    if (get().runningWorkflowId !== workflowId) return undefined;
    return get().runStatus[nodeId];
  },

  toasts: [],
  addToast: (message, type = 'success') => {
    const id = `t${++toastId}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => get().removeToast(id), 3500);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  hydrateAgents: async () => {
    const dbAgents = await loadAgentsFromDb();
    if (dbAgents.length === 0) return;
    const leftovers = dbAgents.filter(isUntitledSkeleton);
    leftovers.forEach((a) => { void deleteAgentFromDb(a.id); });
    const kept = dbAgents.filter((a) => !isUntitledSkeleton(a));
    set((s) => {
      const byId = new Map(s.agents.map((a) => [a.id, a]));
      for (const a of kept) byId.set(a.id, a);
      leftovers.forEach((a) => byId.delete(a.id));
      return { agents: Array.from(byId.values()) };
    });
  },
  hydrateWorkflows: async () => {
    const dbWorkflows = await loadWorkflowsFromDb();
    if (dbWorkflows.length === 0) return;
    set((s) => {
      const byId = new Map(s.workflows.map((w) => [w.id, w]));
      for (const w of dbWorkflows) {
        byId.set(w.id, { ...w, edges: sanitizeWorkflowGraph(w.nodes ?? [], w.edges ?? []) });
      }
      return { workflows: Array.from(byId.values()) };
    });
  },
  hydrateRuns: async () => {
    const dbRuns = await loadRunsFromDb();
    if (dbRuns.length === 0) return;
    set((s) => {
      const existingIds = new Set(s.runs.map((r) => r.id));
      const newFromDb = dbRuns.filter((r) => !existingIds.has(r.id));
      return { runs: [...newFromDb, ...s.runs] };
    });
  },
}));

// Helper: generate a new agent skeleton
export function newAgentSkeleton(): Agent {
  const idNum = ++agentIdCounter;
  return {
    id: `a${idNum}`,
    name: `untitled-agent-${idNum}`,
    displayName: 'Untitled Agent',
    description: '',
    icon: 'Bot',
    type: 'Custom',
    category: 'General',
    tags: [],
    version: '0.1.0',
    owner: 'Suribabu M',
    status: 'draft',
    environment: 'development',
    modelProvider: 'OpenAI',
    modelName: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 4000,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    timeoutSec: 60,
    retryCount: 2,
    prompt: {
      version: 1,
      systemPrompt: '',
      userPromptTemplate: '',
      contextPrompt: '',
      outputInstructions: '',
      errorHandlingInstructions: '',
      createdAt: new Date().toISOString(),
      createdBy: 'Suribabu M',
    },
    promptHistory: [],
    inputs: [],
    output: { id: 'o1', format: 'json', requiredFields: [] },
    tools: [],
    knowledge: [],
    memory: { type: 'none' },
    guardrails: {},
    workflowsUsing: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    persisted: false,
  };
}

export function newWorkflowSkeleton(): Workflow {
  return {
    id: `w${++wfIdCounter}`,
    name: 'New Workflow',
    description: '',
    category: 'General',
    owner: 'Suribabu M',
    tags: [],
    version: '0.1.0',
    environment: 'development',
    triggerType: 'manual',
    defaultInput: '{}',
    maxExecutionTimeSec: 300,
    concurrencyLimit: 1,
    loggingLevel: 'info',
    failurePolicy: 'abort',
    published: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [
      { id: 'start-1', type: 'studioNode', position: { x: 100, y: 200 }, data: { kind: 'control', nodeType: 'start', label: 'Start', status: 'ready' } },
      { id: 'end-1', type: 'studioNode', position: { x: 400, y: 200 }, data: { kind: 'control', nodeType: 'end', label: 'End', status: 'ready' } },
    ],
    edges: [],
  };
}
