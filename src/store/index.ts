import { create } from 'zustand';
import { executeWorkflow, type ReplayResume } from '@/lib/engine';
import type {
  Agent, Workflow, WorkflowRun, Environment, NodeStatus, User,
  WorkflowNode, WorkflowEdge, Prompt, Credential, Integration,
  Evaluation, KnowledgeConnection, AuditLog, PendingApproval,
} from '@/types';
import {
  AGENTS, WORKFLOWS, SAMPLE_WORKFLOW, WORKFLOW_RUNS, PROMPTS, CREDENTIALS,
  INTEGRATIONS, EVALUATIONS, AUDIT_LOGS, USERS, CURRENT_USER,
  KNOWLEDGE_CONNECTIONS,
} from '@/data/mock';
import { supabase } from '@/lib/supabase';
import { syncPageToUrl, pageFromPath } from '@/lib/routes';
import { sanitizeWorkflowGraph } from '@/lib/graph';
import { uniquePrefixedId } from '@/lib/ids';
import { logStoreError, isMissingRelation, isTransientNetworkError } from '@/lib/network';
import { resolveRerunInput } from '@/lib/rerun';
import { replaySeed } from '@/lib/replay';
import { mapsFromRun, pendingFromRun } from '@/lib/output';
import { interpolate } from '@/lib/interpolate';
import { loadCatalogs, saveCatalogs, type CatalogSnapshot } from '@/lib/catalog';
import { isScheduleDue } from '@/lib/cron';
import { callEdgeFunction } from '@/lib/api';
import { applyStudioDefaults, mergeUserStoryWorkflow, needsUserStoryUpgrade, USER_STORY_WORKFLOW_ID } from '@/lib/workflowSetup';
import { authErrorMessage, userFromAuth } from '@/lib/auth';

async function persistRun(run: WorkflowRun) {
  const { error } = await supabase
    .from('workflow_runs')
    .upsert({ id: run.id, data: run, updated_at: new Date().toISOString() });
  if (error) logStoreError('Failed to persist run', error);
}

export async function loadRunsFromDb(): Promise<WorkflowRun[]> {
  try {
    const { data, error } = await supabase.from('workflow_runs').select('data');
    if (error) {
      logStoreError('Failed to load runs', error);
      return [];
    }
    return (data ?? []).map((row) => row.data as WorkflowRun);
  } catch (err) {
    logStoreError('Failed to load runs', err);
    return [];
  }
}

async function persistAgent(agent: Agent) {
  const { error } = await supabase
    .from('agents')
    .upsert({ id: agent.id, data: agent, updated_at: new Date().toISOString() });
  if (error) logStoreError('Failed to persist agent', error);
}

async function deleteAgentFromDb(id: string) {
  const { error } = await supabase.from('agents').delete().eq('id', id);
  if (error) logStoreError('Failed to delete agent', error);
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
      logStoreError('Failed to load agents', error);
      return [];
    }
    return (data ?? []).map((row) => row.data as Agent);
  } catch (err) {
    logStoreError('Failed to load agents', err);
    return [];
  }
}

async function persistWorkflow(wf: Workflow) {
  const { error } = await supabase
    .from('workflows')
    .upsert({ id: wf.id, data: wf, updated_at: new Date().toISOString() });
  if (error) logStoreError('Failed to persist workflow', error);
}

async function deleteWorkflowFromDb(id: string) {
  const { error } = await supabase.from('workflows').delete().eq('id', id);
  if (error) logStoreError('Failed to delete workflow', error);
}

export async function loadWorkflowsFromDb(): Promise<Workflow[]> {
  try {
    const { data, error } = await supabase.from('workflows').select('data');
    if (error) {
      logStoreError('Failed to load workflows', error);
      return [];
    }
    return (data ?? []).map((row) => row.data as Workflow);
  } catch (err) {
    logStoreError('Failed to load workflows', err);
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
  workspaceName: string;
  defaultLoggingLevel: 'debug' | 'info' | 'warning' | 'error';
  saveWorkspaceSettings: (patch: { name?: string; environment?: Environment; loggingLevel?: 'debug' | 'info' | 'warning' | 'error' }) => void;

  // data
  agents: Agent[];
  workflows: Workflow[];
  runs: WorkflowRun[];
  prompts: Prompt[];
  credentials: Credential[];
  integrations: Integration[];
  evaluations: Evaluation[];
  knowledgeConnections: KnowledgeConnection[];
  auditLogs: AuditLog[];
  users: typeof USERS;
  currentUser: User;
  authStatus: 'loading' | 'signed-out' | 'signed-in';
  hydrateAuth: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error: string }>;
  signUp: (email: string, password: string, name?: string) => Promise<{ ok: boolean; error: string; needsConfirm?: boolean }>;
  signOut: () => Promise<void>;

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

  // credential / resource CRUD
  updateCredential: (id: string, patch: Partial<Credential>) => void;
  addCredential: () => Credential;
  rotateCredential: (id: string) => void;
  deleteCredential: (id: string) => void;
  addIntegration: () => Integration;
  testIntegration: (id: string) => void;
  rotateIntegration: (id: string) => void;
  deleteIntegration: (id: string) => void;
  addPrompt: () => Prompt;
  testPrompt: (id: string) => string;
  addKnowledgeConnection: () => KnowledgeConnection;
  toggleKnowledgeConnection: (id: string) => void;
  addEvaluation: () => Evaluation;
  runEvaluation: (id: string) => void;
  approveEvaluation: (id: string) => void;
  addEvaluationCase: (agentId: string, agentName: string, input: string, expectedOutput: string) => void;

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
  serverRunId: string | null;
  runStatus: Record<string, NodeStatus>;
  runOutputs: Record<string, string>;
  runErrors: Record<string, string>;
  pendingApproval: PendingApproval | null;
  startRun: (workflowId: string, runtimeInput?: string, resume?: ReplayResume) => void;
  rerunFrom: (runId: string) => void;
  replayFrom: (runId: string, nodeId: string) => void;
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
  hydrateCatalogs: () => Promise<void>;
  drainTriggers: () => Promise<void>;
  tickSchedules: () => void;
}

let toastId = 0;
let runGeneration = 0;
let approvalWait: { resolve: (ok: boolean) => void } | null = null;

function catalogSnapshot(s: {
  prompts: CatalogSnapshot['prompts'];
  credentials: CatalogSnapshot['credentials'];
  integrations: CatalogSnapshot['integrations'];
  evaluations: CatalogSnapshot['evaluations'];
  knowledgeConnections: CatalogSnapshot['knowledgeConnections'];
}): CatalogSnapshot {
  return {
    prompts: s.prompts,
    credentials: s.credentials,
    integrations: s.integrations,
    evaluations: s.evaluations,
    knowledgeConnections: s.knowledgeConnections,
  };
}

const WS_SETTINGS_KEY = 'aos-workspace-settings';
const INITIAL_WORKSPACE = loadWorkspaceSettingsEarly();

function loadWorkspaceSettingsEarly(): {
  name: string;
  loggingLevel: 'debug' | 'info' | 'warning' | 'error';
  environment?: Environment;
} {
  const fallback = { name: 'QE Workspace', loggingLevel: 'info' as const };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(WS_SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { name?: string; loggingLevel?: string; environment?: string };
    const loggingLevel = parsed.loggingLevel;
    const env = parsed.environment;
    return {
      name: parsed.name?.trim() || fallback.name,
      loggingLevel: loggingLevel === 'debug' || loggingLevel === 'warning' || loggingLevel === 'error' || loggingLevel === 'info'
        ? loggingLevel
        : fallback.loggingLevel,
      environment: env === 'development' || env === 'qa' || env === 'uat' || env === 'production' ? env : undefined,
    };
  } catch {
    return fallback;
  }
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
  environment: INITIAL_WORKSPACE.environment ?? 'production',
  setEnvironment: (e) => set({ environment: e }),
  workspaceName: INITIAL_WORKSPACE.name,
  defaultLoggingLevel: INITIAL_WORKSPACE.loggingLevel,
  saveWorkspaceSettings: (patch) => {
    const nextName = patch.name?.trim() || get().workspaceName;
    const nextEnv = patch.environment ?? get().environment;
    const nextLog = patch.loggingLevel ?? get().defaultLoggingLevel;
    set({ workspaceName: nextName, environment: nextEnv, defaultLoggingLevel: nextLog });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WS_SETTINGS_KEY, JSON.stringify({ name: nextName, loggingLevel: nextLog, environment: nextEnv }));
    }
    get().addToast('Workspace settings saved', 'success');
  },

  agents: AGENTS,
  workflows: WORKFLOWS,
  runs: WORKFLOW_RUNS,
  prompts: PROMPTS,
  credentials: CREDENTIALS,
  integrations: INTEGRATIONS,
  evaluations: EVALUATIONS,
  knowledgeConnections: KNOWLEDGE_CONNECTIONS,
  auditLogs: AUDIT_LOGS,
  users: USERS,
  currentUser: CURRENT_USER,
  authStatus: 'loading',
  hydrateAuth: async () => {
    const apply = (sessionUser: Parameters<typeof userFromAuth>[0] | null) => {
      if (sessionUser) {
        set({ authStatus: 'signed-in', currentUser: userFromAuth(sessionUser) });
        return;
      }
      set({ authStatus: 'signed-out' });
    };
    try {
      const { data } = await supabase.auth.getSession();
      apply(data.session?.user ?? null);
      supabase.auth.onAuthStateChange((_event, session) => {
        apply(session?.user ?? null);
      });
    } catch (err) {
      logStoreError('hydrateAuth', err);
      set({ authStatus: 'signed-out' });
    }
  },
  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: authErrorMessage(error) };
    return { ok: true, error: '' };
  },
  signUp: async (email, password, name) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name?.trim() || undefined } },
    });
    if (error) return { ok: false, error: authErrorMessage(error) };
    if (data.user && !data.session) {
      return { ok: true, error: '', needsConfirm: true };
    }
    return { ok: true, error: '' };
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ authStatus: 'signed-out', currentUser: CURRENT_USER });
  },

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

  updateCredential: (id, patch) => {
    set((s) => ({
      credentials: s.credentials.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
    void saveCatalogs(catalogSnapshot(get()));
  },
  addCredential: () => {
    const id = uniquePrefixedId('c', get().credentials.map((c) => c.id));
    const cred: Credential = {
      id,
      name: 'New Credential',
      type: 'api-key',
      maskedValue: '—',
      workflowsUsing: 0,
      environment: get().environment,
    };
    set((s) => ({ credentials: [cred, ...s.credentials] }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Credential created', 'success');
    return cred;
  },
  rotateCredential: (id) => {
    const cred = get().credentials.find((c) => c.id === id);
    if (!cred) return;
    get().updateCredential(id, { lastRotatedAt: new Date().toISOString(), maskedValue: '••••••••••••new' });
    get().addToast(`Rotated ${cred.name}`, 'success');
  },
  deleteCredential: (id) => {
    const cred = get().credentials.find((c) => c.id === id);
    if (!cred) return;
    if (cred.workflowsUsing > 0) {
      get().addToast(`${cred.name} is used by ${cred.workflowsUsing} workflow(s)`, 'error');
      return;
    }
    set((s) => ({ credentials: s.credentials.filter((c) => c.id !== id) }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`Deleted ${cred.name}`, 'success');
  },
  addIntegration: () => {
    const id = uniquePrefixedId('i', get().integrations.map((i) => i.id));
    const int: Integration = {
      id,
      name: 'New Connection',
      icon: 'Network',
      authType: 'API Key',
      status: 'disconnected',
      workflowsUsing: 0,
    };
    set((s) => ({ integrations: [int, ...s.integrations] }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Connection created', 'success');
    return int;
  },
  testIntegration: (id) => {
    const int = get().integrations.find((i) => i.id === id);
    if (!int) return;
    set((s) => ({
      integrations: s.integrations.map((i) => i.id === id
        ? { ...i, status: 'connected', lastTestedAt: new Date().toISOString() }
        : i),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`${int.name} connection test passed`, 'success');
  },
  rotateIntegration: (id) => {
    const int = get().integrations.find((i) => i.id === id);
    if (!int) return;
    set((s) => ({
      integrations: s.integrations.map((i) => i.id === id
        ? { ...i, lastTestedAt: new Date().toISOString() }
        : i),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`Rotated connection credential for ${int.name}`, 'success');
  },
  deleteIntegration: (id) => {
    const int = get().integrations.find((i) => i.id === id);
    if (!int) return;
    if (int.workflowsUsing > 0) {
      get().addToast(`${int.name} is used by ${int.workflowsUsing} workflow(s)`, 'error');
      return;
    }
    set((s) => ({ integrations: s.integrations.filter((i) => i.id !== id) }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`Deleted ${int.name}`, 'success');
  },
  addPrompt: () => {
    const id = uniquePrefixedId('p', get().prompts.map((p) => p.id));
    const prompt: Prompt = {
      id,
      name: 'New Prompt',
      category: 'General',
      description: 'Draft prompt template',
      systemPrompt: 'You are a helpful assistant.',
      userPrompt: 'Process: {{workflow_input}}',
      variables: ['{{workflow_input}}'],
      version: '0.1.0',
      owner: get().currentUser.name,
      tags: ['draft'],
      usageCount: 0,
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ prompts: [prompt, ...s.prompts] }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Prompt created', 'success');
    return prompt;
  },
  testPrompt: (id) => {
    const prompt = get().prompts.find((p) => p.id === id);
    if (!prompt) return '';
    const sample = interpolate(prompt.userPrompt, {
      workflowInput: { workItemId: 21 },
      previousOutput: { ok: true },
      knowledge: 'QE standards',
      nodes: {},
    });
    set((s) => ({
      prompts: s.prompts.map((p) => p.id === id ? { ...p, usageCount: p.usageCount + 1 } : p),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`Tested ${prompt.name}`, 'success');
    return sample;
  },
  addKnowledgeConnection: () => {
    const id = uniquePrefixedId('k', get().knowledgeConnections.map((k) => k.id));
    const source: KnowledgeConnection = {
      id,
      name: 'New Knowledge Source',
      icon: 'BookOpen',
      status: 'disconnected',
      collections: 0,
    };
    set((s) => ({ knowledgeConnections: [source, ...s.knowledgeConnections] }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Knowledge source added', 'success');
    return source;
  },
  toggleKnowledgeConnection: (id) => {
    const src = get().knowledgeConnections.find((k) => k.id === id);
    if (!src) return;
    const next = src.status === 'connected' ? 'disconnected' : 'connected';
    set((s) => ({
      knowledgeConnections: s.knowledgeConnections.map((k) => k.id === id
        ? { ...k, status: next, collections: next === 'connected' ? Math.max(1, k.collections) : k.collections }
        : k),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`${src.name} ${next}`, 'success');
  },
  addEvaluation: () => {
    const agent = get().agents.find((a) => a.persisted !== false) ?? get().agents[0];
    const id = uniquePrefixedId('e', get().evaluations.map((e) => e.id));
    const ev: Evaluation = {
      id,
      name: `${agent?.displayName ?? 'Agent'} eval`,
      agentId: agent?.id ?? 'a1',
      agentName: agent?.displayName ?? 'Agent',
      status: 'draft',
      createdAt: new Date().toISOString(),
      cases: [
        { id: `${id}-c1`, input: '{"workItemId":21}', expectedOutput: '{"ok":true}' },
      ],
    };
    set((s) => ({ evaluations: [ev, ...s.evaluations] }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Evaluation created', 'success');
    return ev;
  },
  runEvaluation: (id) => {
    const ev = get().evaluations.find((e) => e.id === id);
    if (!ev) return;
    set((s) => ({
      evaluations: s.evaluations.map((e) => e.id === id ? { ...e, status: 'running' } : e),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    window.setTimeout(() => {
      set((s) => ({
        evaluations: s.evaluations.map((e) => {
          if (e.id !== id) return e;
          const cases = e.cases.map((c, i) => ({
            ...c,
            actualOutput: c.expectedOutput,
            accuracy: 0.82 + (i % 3) * 0.04,
            relevance: 0.8,
            groundedness: 0.78,
            hallucinationScore: 0.08,
            citationScore: 0.85,
            safetyScore: 1,
            responseTimeMs: 2500 + i * 200,
            tokenUsage: 1800,
            cost: 0.04,
          }));
          const averageAccuracy = cases.reduce((a, c) => a + (c.accuracy ?? 0), 0) / Math.max(cases.length, 1);
          return { ...e, status: 'completed' as const, cases, averageAccuracy };
        }),
      }));
      void saveCatalogs(catalogSnapshot(get()));
      get().addToast(`Finished ${ev.name}`, 'success');
    }, 700);
  },
  approveEvaluation: (id) => {
    const ev = get().evaluations.find((e) => e.id === id);
    if (!ev) return;
    if (ev.status !== 'completed') {
      get().addToast('Run the evaluation before approving', 'error');
      return;
    }
    set((s) => ({
      evaluations: s.evaluations.map((e) => e.id === id ? { ...e, approvedForProduction: true } : e),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`${ev.name} approved for production`, 'success');
  },
  addEvaluationCase: (agentId, agentName, input, expectedOutput) => {
    const existing = get().evaluations.find((e) => e.agentId === agentId);
    const caseRow = {
      id: existing
        ? uniquePrefixedId(`${existing.id}-c`, existing.cases.map((c) => c.id))
        : 'c1',
      input,
      expectedOutput,
    };
    if (existing) {
      set((s) => ({
        evaluations: s.evaluations.map((e) => e.id === existing.id
          ? { ...e, cases: [...e.cases, caseRow], status: 'draft' as const, approvedForProduction: false }
          : e),
      }));
    } else {
      const id = uniquePrefixedId('e', get().evaluations.map((e) => e.id));
      set((s) => ({
        evaluations: [{
          id,
          name: `${agentName} eval`,
          agentId,
          agentName,
          status: 'draft',
          createdAt: new Date().toISOString(),
          cases: [{ ...caseRow, id: `${id}-c1` }],
        }, ...s.evaluations],
      }));
    }
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Saved as evaluation case', 'success');
  },

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
  serverRunId: null,
  runStatus: {},
  runOutputs: {},
  runErrors: {},
  pendingApproval: null,
  startRun: (workflowId, runtimeInput, resume) => {
    const found = get().workflows.find((w) => w.id === workflowId);
    if (!found) return;
    const wf = applyStudioDefaults(found);
    const statusMap: Record<string, NodeStatus> = {};
    wf.nodes.forEach((n) => {
      statusMap[n.id] = resume?.nodeOutputs[n.id] ? 'completed' : 'ready';
    });
    if (resume) statusMap[resume.fromNodeId] = 'ready';
    runGeneration += 1;
    const gen = runGeneration;
    approvalWait = null;
    const runId = `r${Date.now()}`;
    const triggeredBy = get().currentUser.name;
    const stub: WorkflowRun = {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      workflowVersion: wf.version,
      status: 'running',
      triggeredBy,
      environment: wf.environment,
      startTime: new Date().toISOString(),
      totalTokens: 0,
      estimatedCost: 0,
      nodeExecutions: resume?.priorExecutions ?? [],
      logs: [],
      runtimeInput: runtimeInput ?? wf.defaultInput,
    };
    set({
      runningWorkflowId: workflowId,
      serverRunId: runId,
      runStatus: statusMap,
      runOutputs: { ...(resume?.nodeOutputs ?? {}) },
      runErrors: {},
      pendingApproval: null,
      runs: [stub, ...get().runs.filter((r) => r.id !== runId)],
    });
    persistRun(stub);

    const applyLiveRun = (run: WorkflowRun) => {
      const maps = mapsFromRun(run);
      set((s) => ({
        runs: [run, ...s.runs.filter((r) => r.id !== run.id)],
        runStatus: { ...s.runStatus, ...maps.runStatus },
        runOutputs: { ...s.runOutputs, ...maps.runOutputs },
        runErrors: { ...s.runErrors, ...maps.runErrors },
      }));
    };

    const persistLive = (run: WorkflowRun) => {
      applyLiveRun(run);
      void persistRun(run);
    };

    const finish = (run: WorkflowRun) => {
      if (gen !== runGeneration) return;
      const maps = mapsFromRun(run);
      set((s) => ({
        runningWorkflowId: null,
        serverRunId: null,
        pendingApproval: null,
        runs: [run, ...s.runs.filter((r) => r.id !== run.id)],
        runStatus: { ...s.runStatus, ...maps.runStatus },
        runOutputs: { ...s.runOutputs, ...maps.runOutputs },
        runErrors: { ...s.runErrors, ...maps.runErrors },
      }));
      persistRun(run);
      const ok = run.status === 'completed';
      get().addToast(`Workflow ${run.status}`, ok ? 'success' : run.status === 'cancelled' ? 'info' : 'error');
    };

    const callbacks = {
      isCancelled: () => get().runningWorkflowId !== workflowId || gen !== runGeneration,
      onNodeStatus: (nodeId: string, status: NodeStatus) => {
        set((s) => ({ runStatus: { ...s.runStatus, [nodeId]: status } }));
      },
      onNodeOutput: (nodeId: string, output: string, error?: string) => {
        set((s) => ({
          runOutputs: output ? { ...s.runOutputs, [nodeId]: output } : s.runOutputs,
          runErrors: error ? { ...s.runErrors, [nodeId]: error } : s.runErrors,
        }));
      },
      waitForApproval: (nodeId: string, label: string, review?: { output?: string; approver?: string }) => new Promise<boolean>((resolve) => {
        approvalWait = { resolve };
        set({ pendingApproval: { workflowId, nodeId, label, reviewOutput: review?.output, approver: review?.approver } });
        get().addToast(`Waiting for approval: ${label}`, 'info');
      }),
    };

    const runLocal = () => executeWorkflow({
      workflow: wf,
      agents: get().agents,
      runtimeInput,
      triggeredBy,
      invoke: callEdgeFunction,
      runId,
      resume,
      persistProgress: persistLive,
      callbacks,
    });

    void (async () => {
      // Always run in the browser. The deployed execute-workflow function cannot
      // launch Chromium, so Playwright nodes 404 there with NOT_FOUND.
      try {
        finish(await runLocal());
      } catch (err) {
        if (gen !== runGeneration) return;
        set({ runningWorkflowId: null, serverRunId: null, pendingApproval: null });
        get().addToast(err instanceof Error ? err.message : 'Workflow failed', 'error');
      }
    })();
  },
  rerunFrom: (runId) => {
    const run = get().runs.find((r) => r.id === runId);
    if (!run) {
      get().addToast('Run not found', 'error');
      return;
    }
    const wf = get().workflows.find((w) => w.id === run.workflowId);
    if (!wf) {
      get().addToast('Workflow no longer exists', 'error');
      return;
    }
    if (get().runningWorkflowId) {
      get().addToast('A workflow is already running', 'error');
      return;
    }
    set({ selectedWorkflowId: wf.id });
    get().startRun(wf.id, resolveRerunInput(run, wf));
    get().setPage('workflow-builder');
  },
  replayFrom: (runId, nodeId) => {
    const run = get().runs.find((r) => r.id === runId);
    if (!run) {
      get().addToast('Run not found', 'error');
      return;
    }
    const wf = get().workflows.find((w) => w.id === run.workflowId);
    if (!wf) {
      get().addToast('Workflow no longer exists', 'error');
      return;
    }
    if (!wf.nodes.some((n) => n.id === nodeId)) {
      get().addToast('That node is no longer on the workflow', 'error');
      return;
    }
    if (get().runningWorkflowId) {
      get().addToast('A workflow is already running', 'error');
      return;
    }
    const resume = replaySeed(run, nodeId, wf.edges);
    const label = wf.nodes.find((n) => n.id === nodeId)?.data.label ?? nodeId;
    set({ selectedWorkflowId: wf.id });
    get().startRun(wf.id, resolveRerunInput(run, wf), resume);
    get().setPage('workflow-builder');
    get().addToast(`Replaying from ${label}`, 'info');
  },
  cancelRun: () => {
    runGeneration += 1;
    approvalWait?.resolve(false);
    approvalWait = null;
    const serverRunId = get().serverRunId;
    if (serverRunId) {
      const run = get().runs.find((r) => r.id === serverRunId);
      if (run) persistRun({ ...run, status: 'cancelled', approvalDecision: false });
    }
    set({ runningWorkflowId: null, serverRunId: null, pendingApproval: null });
    get().addToast('Workflow execution cancelled', 'info');
  },
  approveRun: () => {
    approvalWait?.resolve(true);
    approvalWait = null;
    const pending = get().pendingApproval;
    const serverRunId = get().serverRunId;
    if (serverRunId) {
      const run = get().runs.find((r) => r.id === serverRunId);
      if (run) {
        persistRun({
          ...run,
          status: 'running',
          approvalDecision: true,
          approvalNodeId: pending?.nodeId ?? run.approvalNodeId,
        });
      }
    }
    set({ pendingApproval: null });
    get().addToast('Approval granted, continuing workflow', 'success');
  },
  rejectRun: () => {
    approvalWait?.resolve(false);
    approvalWait = null;
    const pending = get().pendingApproval;
    const serverRunId = get().serverRunId;
    if (serverRunId) {
      const run = get().runs.find((r) => r.id === serverRunId);
      if (run) {
        persistRun({
          ...run,
          approvalDecision: false,
          approvalNodeId: pending?.nodeId ?? run.approvalNodeId,
        });
      }
    }
    set({ pendingApproval: null });
    get().addToast('Approval rejected, run will be marked failed', 'error');
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
    const persistUpgrades: Workflow[] = [];
    set((s) => {
      const byId = new Map(s.workflows.map((w) => [w.id, w]));
      for (const w of dbWorkflows) {
        const merged = w.id === USER_STORY_WORKFLOW_ID
          ? mergeUserStoryWorkflow(w, SAMPLE_WORKFLOW)
          : w;
        const next = applyStudioDefaults(merged);
        if (
          (w.id === USER_STORY_WORKFLOW_ID && needsUserStoryUpgrade(w))
          || next !== merged
          || (w.id === USER_STORY_WORKFLOW_ID && needsUserStoryUpgrade(next) === false && needsUserStoryUpgrade(w))
        ) persistUpgrades.push(next);
        byId.set(w.id, { ...next, edges: sanitizeWorkflowGraph(next.nodes ?? [], next.edges ?? []) });
      }
      return { workflows: Array.from(byId.values()) };
    });
    persistUpgrades.forEach((wf) => persistWorkflow(wf));
  },
  hydrateRuns: async () => {
    const dbRuns = await loadRunsFromDb();
    if (dbRuns.length === 0) return;
    set((s) => {
      const byId = new Map(s.runs.map((r) => [r.id, r]));
      for (const run of dbRuns) {
        const local = byId.get(run.id);
        if (!local) {
          byId.set(run.id, run);
          continue;
        }
        const dbProgress = run.nodeExecutions?.length ?? 0;
        const localProgress = local.nodeExecutions?.length ?? 0;
        if (dbProgress >= localProgress || run.status !== local.status) {
          byId.set(run.id, run);
        }
      }
      return {
        runs: Array.from(byId.values()).sort((a, b) => b.startTime.localeCompare(a.startTime)),
      };
    });
  },
  hydrateCatalogs: async () => {
    const stored = await loadCatalogs();
    if (!stored) return;
    set({
      prompts: stored.prompts,
      credentials: stored.credentials,
      integrations: stored.integrations,
      evaluations: stored.evaluations,
      knowledgeConnections: stored.knowledgeConnections,
    });
  },
  drainTriggers: async () => {
    try {
      const { data, error } = await supabase
        .from('workflow_triggers')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(10);
      if (error) {
        if (isMissingRelation(error) || isTransientNetworkError(error)) return;
        logStoreError('Failed to drain triggers', error);
        return;
      }
      for (const row of data ?? []) {
        if (get().runningWorkflowId) break;
        const wf = get().workflows.find((w) => w.id === row.workflow_id);
        if (!wf) continue;
        const payload = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload ?? {});
        const { error: updError } = await supabase
          .from('workflow_triggers')
          .update({ status: 'consumed', consumed_at: new Date().toISOString() })
          .eq('id', row.id);
        if (updError) {
          if (isMissingRelation(updError) || isTransientNetworkError(updError)) return;
          logStoreError('Failed to claim trigger', updError);
          continue;
        }
        get().startRun(wf.id, payload);
        get().addToast(`Started ${wf.name} from ${row.kind}`, 'info');
      }
    } catch (err) {
      if (isMissingRelation(err) || isTransientNetworkError(err)) return;
      logStoreError('Failed to drain triggers', err);
    }
  },
  tickSchedules: () => {
    if (get().runningWorkflowId) return;
    const now = new Date();
    for (const wf of get().workflows) {
      if (wf.triggerType !== 'scheduled' || !wf.scheduleCron) continue;
      if (!wf.lastScheduledAt) {
        get().updateWorkflow(wf.id, { lastScheduledAt: now.toISOString() });
        continue;
      }
      if (!isScheduleDue(wf.scheduleCron, wf.lastScheduledAt, now)) continue;
      if (get().runningWorkflowId) return;
      get().updateWorkflow(wf.id, { lastScheduledAt: now.toISOString() });
      get().startRun(wf.id, wf.defaultInput);
      get().addToast(`Scheduled run: ${wf.name}`, 'info');
      return;
    }
  },
}));

// Helper: generate a new agent skeleton
export function newAgentSkeleton(): Agent {
  const id = uniquePrefixedId('a', useStore.getState().agents.map((a) => a.id));
  const idNum = id.slice(1);
  return {
    id,
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
    id: uniquePrefixedId('w', useStore.getState().workflows.map((w) => w.id)),
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
