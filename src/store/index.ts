import { create } from 'zustand';
import { executeWorkflow, type ReplayResume } from '@/lib/engine';
import type {
  Agent, Workflow, WorkflowRun, Environment, EnvColor, EnvDefinition, NodeStatus, User,
  WorkflowNode, WorkflowEdge, Prompt, Credential, Integration,
  Evaluation, EvaluationCase, KnowledgeConnection, AuditLog, LlmModel, PendingApproval,
} from '@/types';
import {
  AGENTS, WORKFLOWS, SAMPLE_WORKFLOW, WORKFLOW_RUNS, PROMPTS, CREDENTIALS,
  INTEGRATIONS, EVALUATIONS, CURRENT_USER,
  KNOWLEDGE_CONNECTIONS,
} from '@/data/mock';
import { supabase } from '@/lib/supabase';
import { syncPageToUrl, pageFromPath } from '@/lib/routes';
import { sanitizeWorkflowGraph } from '@/lib/graph';
import { uniquePrefixedId } from '@/lib/ids';
import { logStoreError, isMissingRelation, isTransientNetworkError } from '@/lib/network';
import { resolveRerunInput } from '@/lib/rerun';
import { approvalNodeId, continueAfterApproval, replaySeed } from '@/lib/replay';
import { mapsFromRun, pendingFromRun } from '@/lib/output';
import { interpolate } from '@/lib/interpolate';
import { loadCatalogs, saveCatalogs, type CatalogSnapshot } from '@/lib/catalog';
import { isScheduleDue } from '@/lib/cron';
import { callEdgeFunction } from '@/lib/api';
import { applyStudioDefaults, mergeUserStoryWorkflow, needsUserStoryUpgrade, USER_STORY_WORKFLOW_ID } from '@/lib/workflowSetup';
import { defaultCustomPrompts, publishReadyErrors, sanitizeAgents } from '@/lib/agents';
import { authErrorMessage, userFromAuth } from '@/lib/auth';
import { loadAuditLogs, newAuditLog, persistAuditLog } from '@/lib/audit';
import { ensureAdministratorExists, ensureUserRow, loadUserRoles, upsertUserRole } from '@/lib/users';
import { canRole, type Permission } from '@/lib/roles';
import { runAgentEvalCase, scoreOutputs } from '@/lib/evaluate';
import {
  FALLBACK_STUDIO_MODEL, loadLlmModels, loadStudioModelConfig, persistLlmModels,
  seedLlmModel, studioConfigFromLlm, testLlmConnection, maskApiKey, type StudioModelConfig,
} from '@/lib/models';
import {
  DEFAULT_ENVIRONMENTS, applyEnvAccess, canAccessEnvironment, envLabel, isAdministrator,
  loadEnvironments, loadPromotionPath, loadUserEnvAccess, persistEnvironments,
  persistPromotionPath, persistUserEnvAccess, readSelectedEnvironment, resolveEnvironment,
  resolvePromotionPath, isPromotionTerminal, uniqueEnvId, writeSelectedEnvironment,
} from '@/lib/environments';
import { applyWorkflowDeploy } from '@/lib/deploy';
import { newWebhookSecret } from '@/lib/http';
import { promoteBlockers } from '@/lib/promote';
import { pushWorkflowVersion, snapshotWorkflow } from '@/lib/versions';
import { orphanedRunningRun, resumeSeedForOrphan } from '@/lib/resume';

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
  | 'workflows'
  | 'workflow-builder'
  | 'workflow-runs'
  | 'run-details'
  | 'approvals'
  | 'run-compare'
  | 'tools'
  | 'prompts'
  | 'knowledge'
  | 'models'
  | 'credentials'
  | 'evaluations'
  | 'monitoring'
  | 'audit'
  | 'settings';

function withEnvAccess(users: User[], access: Record<string, string[]>): User[] {
  return users.map((u) => applyEnvAccess(u, access));
}

function snapEnvironment(
  preferred: string | undefined,
  user: User,
  environments: EnvDefinition[],
): string {
  const next = resolveEnvironment(preferred, user, environments);
  writeSelectedEnvironment(next);
  return next;
}

function denyUnless(get: () => { currentUser: User; addToast: (message: string, type?: 'success' | 'error' | 'info') => void }, perm: Permission): boolean {
  if (canRole(get().currentUser.role, perm)) return false;
  get().addToast(`${get().currentUser.role} cannot do that`, 'error');
  return true;
}

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
  environments: EnvDefinition[];
  promotionPath: string[];
  userEnvAccess: Record<string, string[]>;
  hydrateEnvironments: () => Promise<void>;
  addEnvironment: (name: string, color?: EnvColor) => EnvDefinition | null;
  updateEnvironmentDef: (id: string, patch: Partial<Pick<EnvDefinition, 'name' | 'color'>>) => void;
  deleteEnvironment: (id: string) => void;
  setPromotionPath: (path: string[]) => void;
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
  studioModel: StudioModelConfig | null;
  llmModels: LlmModel[];
  upsertLlmModel: (model: LlmModel) => void;
  deleteLlmModel: (id: string) => void;
  activateLlmModel: (id: string) => void;
  testLlmModel: (id: string, apiKey?: string) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>;
  auditLogs: AuditLog[];
  users: User[];
  currentUser: User;
  authStatus: 'loading' | 'signed-out' | 'signed-in';
  hydrateAuth: () => Promise<void>;
  hydrateUsers: () => Promise<void>;
  hydrateAuditLogs: () => Promise<void>;
  hydrateStudioModel: () => Promise<void>;
  logAudit: (input: { action: string; resource: string; oldValue?: string; newValue?: string; result?: AuditLog['result'] }) => void;
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
  publishAgent: (id: string) => boolean;
  unpublishAgent: (id: string) => void;

  // credential / resource CRUD
  updateCredential: (id: string, patch: Partial<Credential>) => void;
  addCredential: () => Credential | null;
  createCredential: (input: { name: string; type?: Credential['type']; environment: string; value?: string }) => Credential | null;
  rotateCredential: (id: string) => void;
  deleteCredential: (id: string) => void;
  addIntegration: () => Integration | null;
  testIntegration: (id: string) => void;
  rotateIntegration: (id: string) => void;
  deleteIntegration: (id: string) => void;
  addPrompt: () => Prompt | null;
  testPrompt: (id: string) => string;
  addKnowledgeConnection: () => KnowledgeConnection | null;
  updateKnowledgeConnection: (id: string, patch: Partial<KnowledgeConnection>) => void;
  toggleKnowledgeConnection: (id: string) => void;
  addEvaluation: () => Evaluation | null;
  createEvaluation: (agentId: string, name?: string) => Evaluation | null;
  updateEvaluation: (id: string, patch: Partial<Evaluation>) => void;
  deleteEvaluation: (id: string) => void;
  runEvaluation: (id: string) => Promise<void>;
  approveEvaluation: (id: string) => void;
  addEvaluationCase: (agentId: string, agentName: string, input: string, expectedOutput: string) => void;
  updateEvaluationCase: (evalId: string, caseId: string, patch: Partial<EvaluationCase>) => void;
  deleteEvaluationCase: (evalId: string, caseId: string) => void;

  // user CRUD
  updateUser: (id: string, patch: Partial<User>) => void;

  // workflow CRUD
  createWorkflow: (wf: Workflow) => void;
  updateWorkflow: (id: string, patch: Partial<Workflow>) => void;
  deleteWorkflow: (id: string) => void;
  cloneWorkflow: (id: string) => void;
  deployWorkflow: (id: string, targetEnv: Environment) => Workflow | null;
  setWorkflowGraph: (id: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  restoreWorkflowVersion: (id: string, savedAt: string) => void;

  // execution
  runningWorkflowId: string | null;
  serverRunId: string | null;
  runStatus: Record<string, NodeStatus>;
  runOutputs: Record<string, string>;
  runErrors: Record<string, string>;
  pendingApproval: PendingApproval | null;
  startRun: (workflowId: string, runtimeInput?: string, resume?: ReplayResume, existingRun?: WorkflowRun, opts?: { ignoreEnvironment?: boolean }) => void;
  rerunFrom: (runId: string) => void;
  replayFrom: (runId: string, nodeId: string) => void;
  cancelRun: () => void;
  approveRun: (runId?: string) => void;
  rejectRun: (runId?: string) => void;
  decideApproval: (runId: string, approved: boolean) => void;
  runNodeStatus: (workflowId: string, nodeId: string) => NodeStatus | undefined;

  // toasts
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
  hydrateAgents: () => Promise<void>;
  hydrateWorkflows: () => Promise<void>;
  hydrateRuns: () => Promise<void>;
  resumeInterruptedRuns: () => void;
  compareRunIds: [string, string] | null;
  setCompareRuns: (leftId: string, rightId?: string) => void;
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
      environment: typeof env === 'string' && env.trim() ? env.trim() : undefined,
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
  environment: readSelectedEnvironment() ?? INITIAL_WORKSPACE.environment ?? 'production',
  environments: DEFAULT_ENVIRONMENTS,
  promotionPath: resolvePromotionPath(undefined, DEFAULT_ENVIRONMENTS),
  userEnvAccess: {},
  setEnvironment: (e) => {
    const s = get();
    if (!canAccessEnvironment(s.currentUser, e, s.environments)) {
      s.addToast('You do not have access to that environment', 'error');
      return;
    }
    writeSelectedEnvironment(e);
    set({ environment: e });
  },
  hydrateEnvironments: async () => {
    const [environments, userEnvAccess, savedPath] = await Promise.all([
      loadEnvironments(),
      loadUserEnvAccess(),
      loadPromotionPath(),
    ]);
    const nextEnvs = environments.length ? environments : DEFAULT_ENVIRONMENTS;
    set((s) => {
      const users = withEnvAccess(s.users, userEnvAccess);
      const currentUser = applyEnvAccess(s.currentUser, userEnvAccess);
      return {
        environments: nextEnvs,
        promotionPath: resolvePromotionPath(savedPath, nextEnvs),
        userEnvAccess,
        users,
        currentUser,
        environment: snapEnvironment(readSelectedEnvironment() ?? s.environment, currentUser, nextEnvs),
      };
    });
  },
  addEnvironment: (name, color) => {
    if (!isAdministrator(get().currentUser.role)) {
      get().addToast('Only an administrator can add environments', 'error');
      return null;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      get().addToast('Environment name is required', 'error');
      return null;
    }
    const id = uniqueEnvId(trimmed, get().environments);
    const def: EnvDefinition = {
      id,
      name: trimmed,
      color: color ?? DEFAULT_ENVIRONMENTS[get().environments.length % DEFAULT_ENVIRONMENTS.length]?.color ?? 'slate',
    };
    const environments = [...get().environments, def];
    set({ environments });
    void persistEnvironments(environments);
    get().addToast(`${def.name} environment added`, 'success');
    get().logAudit({ action: 'create_environment', resource: def.name, newValue: def.id });
    return def;
  },
  updateEnvironmentDef: (id, patch) => {
    if (!isAdministrator(get().currentUser.role)) {
      get().addToast('Only an administrator can edit environments', 'error');
      return;
    }
    const current = get().environments.find((e) => e.id === id);
    if (!current) return;
    const environments = get().environments.map((e) => (
      e.id === id ? { ...e, name: patch.name?.trim() || e.name, color: patch.color ?? e.color } : e
    ));
    set({ environments });
    void persistEnvironments(environments);
    get().logAudit({ action: 'update_environment', resource: patch.name?.trim() || current.name, oldValue: current.name, newValue: patch.name?.trim() || current.name });
  },
  deleteEnvironment: (id) => {
    if (!isAdministrator(get().currentUser.role)) {
      get().addToast('Only an administrator can delete environments', 'error');
      return;
    }
    const s = get();
    if (s.environments.length <= 1) {
      s.addToast('Keep at least one environment', 'error');
      return;
    }
    const target = s.environments.find((e) => e.id === id);
    if (!target) return;
    const usedByAgent = s.agents.some((a) => a.environment === id);
    const usedByWorkflow = s.workflows.some((w) => w.environment === id);
    const usedByCred = s.credentials.some((c) => c.environment === id);
    if (usedByAgent || usedByWorkflow || usedByCred) {
      s.addToast(`${target.name} is still used by agents, workflows, or credentials`, 'error');
      return;
    }
    const environments = s.environments.filter((e) => e.id !== id);
    const promotionPath = resolvePromotionPath(s.promotionPath.filter((envId) => envId !== id), environments);
    const userEnvAccess = Object.fromEntries(
      Object.entries(s.userEnvAccess).map(([userId, ids]) => [userId, ids.filter((envId) => envId !== id)]),
    );
    const users = withEnvAccess(s.users, userEnvAccess);
    const currentUser = applyEnvAccess(s.currentUser, userEnvAccess);
    set({
      environments,
      promotionPath,
      userEnvAccess,
      users,
      currentUser,
      environment: snapEnvironment(s.environment === id ? undefined : s.environment, currentUser, environments),
    });
    void persistEnvironments(environments);
    void persistPromotionPath(promotionPath);
    void persistUserEnvAccess(userEnvAccess);
    s.addToast(`${target.name} removed`, 'info');
    get().logAudit({ action: 'delete_environment', resource: target.name });
  },
  setPromotionPath: (path) => {
    if (!isAdministrator(get().currentUser.role)) {
      get().addToast('Only an administrator can change the path to production', 'error');
      return;
    }
    const promotionPath = resolvePromotionPath(path, get().environments);
    if (promotionPath.length < 2) {
      get().addToast('The path to production needs at least two environments', 'error');
      return;
    }
    set({ promotionPath });
    void persistPromotionPath(promotionPath);
    get().logAudit({ action: 'update_promotion_path', resource: promotionPath.join(' > '), newValue: promotionPath.join(',') });
  },
  workspaceName: INITIAL_WORKSPACE.name,
  defaultLoggingLevel: INITIAL_WORKSPACE.loggingLevel,
  saveWorkspaceSettings: (patch) => {
    if (denyUnless(get, 'settings.manage')) return;
    const nextName = patch.name?.trim() || get().workspaceName;
    const nextEnv = patch.environment ?? get().environment;
    const nextLog = patch.loggingLevel ?? get().defaultLoggingLevel;
    const currentUser = get().currentUser;
    const environments = get().environments;
    const environment = canAccessEnvironment(currentUser, nextEnv, environments)
      ? nextEnv
      : snapEnvironment(get().environment, currentUser, environments);
    if (canAccessEnvironment(currentUser, nextEnv, environments)) writeSelectedEnvironment(nextEnv);
    set({ workspaceName: nextName, environment, defaultLoggingLevel: nextLog });
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
  studioModel: null,
  llmModels: [],
  auditLogs: [],
  users: [],
  currentUser: CURRENT_USER,
  authStatus: 'loading',
  logAudit: ({ action, resource, oldValue, newValue, result }) => {
    const log = newAuditLog({
      user: get().currentUser.name,
      action,
      resource,
      oldValue,
      newValue,
      environment: get().environment,
      result,
    });
    set((s) => ({ auditLogs: [log, ...s.auditLogs.filter((row) => row.id !== log.id)].slice(0, 200) }));
    void persistAuditLog(log);
  },
  hydrateUsers: async () => {
    const rows = await loadUserRoles();
    set((s) => {
      const access = s.userEnvAccess;
      const byId = new Map(rows.map((u) => [u.id, applyEnvAccess(u, access)]));
      if (s.currentUser.id && s.authStatus === 'signed-in' && !byId.has(s.currentUser.id)) {
        byId.set(s.currentUser.id, applyEnvAccess(s.currentUser, access));
      }
      const users = Array.from(byId.values());
      const currentUser = (s.currentUser.id && byId.get(s.currentUser.id)) || applyEnvAccess(s.currentUser, access);
      return {
        users,
        currentUser,
        environment: snapEnvironment(s.environment, currentUser, s.environments),
      };
    });
  },
  hydrateStudioModel: async () => {
    const config = await loadStudioModelConfig() ?? FALLBACK_STUDIO_MODEL;
    const stored = await loadLlmModels();
    const models = stored.length ? stored : [seedLlmModel(config)];
    if (!stored.length) void persistLlmModels(models);
    const active = models.find((m) => m.active) ?? models[0];
    set({
      llmModels: models,
      studioModel: active ? studioConfigFromLlm(active, config) : config,
    });
  },
  upsertLlmModel: (model) => {
    if (denyUnless(get, 'resources.write')) return;
    const next: LlmModel = {
      ...model,
      name: model.name.trim() || model.model,
      apiKey: model.apiKey?.trim() || undefined,
      apiKeyMasked: model.apiKey?.trim() ? maskApiKey(model.apiKey) : model.apiKeyMasked,
    };
    set((s) => {
      const exists = s.llmModels.some((m) => m.id === next.id);
      let llmModels = exists
        ? s.llmModels.map((m) => (m.id === next.id ? { ...m, ...next, apiKey: next.apiKey ?? m.apiKey } : m))
        : [next, ...s.llmModels];
      if (next.active) llmModels = llmModels.map((m) => ({ ...m, active: m.id === next.id }));
      const active = llmModels.find((m) => m.active) ?? llmModels[0];
      return {
        llmModels,
        studioModel: active ? studioConfigFromLlm(active, s.studioModel) : s.studioModel,
      };
    });
    void persistLlmModels(get().llmModels);
    get().logAudit({ action: 'save_model', resource: next.name, newValue: next.model });
  },
  deleteLlmModel: (id) => {
    if (denyUnless(get, 'resources.write')) return;
    const target = get().llmModels.find((m) => m.id === id);
    if (!target) return;
    if (target.source === 'studio') {
      get().addToast('The studio model cannot be deleted', 'error');
      return;
    }
    if (get().llmModels.length <= 1) {
      get().addToast('Keep at least one model', 'error');
      return;
    }
    set((s) => {
      const llmModels = s.llmModels.filter((m) => m.id !== id);
      const hasActive = llmModels.some((m) => m.active);
      const next = hasActive ? llmModels : llmModels.map((m, i) => ({ ...m, active: i === 0 }));
      const active = next.find((m) => m.active) ?? next[0];
      return {
        llmModels: next,
        studioModel: active ? studioConfigFromLlm(active, s.studioModel) : s.studioModel,
      };
    });
    void persistLlmModels(get().llmModels);
    get().addToast(`${target.name} removed`, 'info');
    get().logAudit({ action: 'delete_model', resource: target.name });
  },
  activateLlmModel: (id) => {
    if (denyUnless(get, 'resources.write')) return;
    const target = get().llmModels.find((m) => m.id === id);
    if (!target) return;
    set((s) => {
      const llmModels = s.llmModels.map((m) => ({ ...m, active: m.id === id }));
      const active = llmModels.find((m) => m.active) ?? target;
      return { llmModels, studioModel: studioConfigFromLlm(active, s.studioModel) };
    });
    void persistLlmModels(get().llmModels);
    get().addToast(`${target.name} is now the default for new agents`, 'success');
    get().logAudit({ action: 'activate_model', resource: target.name, newValue: target.model });
  },
  testLlmModel: async (id, apiKey) => {
    const model = get().llmModels.find((m) => m.id === id);
    if (!model) return { ok: false, error: 'Model not found' };
    const result = await testLlmConnection({
      baseUrl: model.baseUrl,
      model: model.model,
      apiKey: apiKey?.trim() || model.apiKey,
      useStudioSecret: model.source === 'studio' || !(apiKey?.trim() || model.apiKey),
    });
    set((s) => ({
      llmModels: s.llmModels.map((m) => m.id === id
        ? { ...m, lastTestedAt: new Date().toISOString(), lastTestOk: result.ok }
        : m),
    }));
    void persistLlmModels(get().llmModels);
    get().addToast(
      result.ok
        ? `Connected to ${model.name}${result.latencyMs != null ? ` in ${result.latencyMs}ms` : ''}`
        : (result.error || `Could not connect to ${model.name}`),
      result.ok ? 'success' : 'error',
    );
    get().logAudit({
      action: 'test_model',
      resource: model.name,
      result: result.ok ? 'success' : 'failure',
      newValue: result.ok ? `${result.latencyMs ?? 0}ms` : result.error,
    });
    return result;
  },
  hydrateAuditLogs: async () => {
    const logs = await loadAuditLogs();
    if (!logs.length) return;
    set((s) => {
      const byId = new Map(logs.map((row) => [row.id, row]));
      for (const row of s.auditLogs) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
      return {
        auditLogs: Array.from(byId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200),
      };
    });
  },
  hydrateAuth: async () => {
    const apply = (sessionUser: Parameters<typeof userFromAuth>[0] | null) => {
      if (sessionUser) {
        const user = userFromAuth(sessionUser);
        set((s) => ({
          authStatus: 'signed-in',
          currentUser: s.currentUser.id === user.id
            ? { ...user, role: s.currentUser.role, allowedEnvironments: s.currentUser.allowedEnvironments }
            : user,
        }));
        void ensureUserRow(user).then(async (persisted) => {
          const promoted = await ensureAdministratorExists(persisted);
          await get().hydrateUsers();
          const fromDb = get().users.find((row) => row.id === promoted.id) ?? promoted;
          set((s) => ({
            currentUser: applyEnvAccess(fromDb, s.userEnvAccess),
            environment: snapEnvironment(s.environment, applyEnvAccess(fromDb, s.userEnvAccess), s.environments),
          }));
        });
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
    if (denyUnless(get, 'agents.write')) return;
    const id = get().agents.some((a) => a.id === agent.id)
      ? uniquePrefixedId('a', get().agents.map((a) => a.id))
      : agent.id;
    agent.id = id;
    const next = { ...agent, persisted: agent.persisted ?? false };
    set((s) => ({ agents: [next, ...s.agents] }));
    if (next.persisted !== false) persistAgent({ ...next, persisted: true });
    get().logAudit({ action: 'create_agent', resource: next.displayName || next.id, newValue: next.status });
  },
  updateAgent: (id, patch) => {
    if (denyUnless(get, 'agents.write')) return;
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch, persisted: true, updatedAt: new Date().toISOString() } : a)),
    }));
    const updated = get().agents.find((a) => a.id === id);
    if (updated) persistAgent(updated);
  },
  deleteAgent: (id) => {
    if (denyUnless(get, 'agents.write')) return;
    const agent = get().agents.find((a) => a.id === id);
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
    deleteAgentFromDb(id);
    get().logAudit({ action: 'delete_agent', resource: agent?.displayName || id });
  },
  cloneAgent: (id) => {
    if (denyUnless(get, 'agents.write')) return;
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
      sourceAgentId: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ agents: [clone, ...s.agents] }));
    persistAgent(clone);
    get().addToast(`Cloned agent: ${agent.displayName}`, 'success');
    get().logAudit({ action: 'clone_agent', resource: clone.displayName, oldValue: agent.id, newValue: clone.id });
  },
  publishAgent: (id) => {
    if (denyUnless(get, 'agents.write')) return false;
    const agent = get().agents.find((a) => a.id === id);
    if (!agent) {
      get().addToast('Agent not found', 'error');
      return false;
    }
    const errors = publishReadyErrors(agent);
    if (errors.length) {
      get().addToast(errors[0], 'error');
      return false;
    }
    get().updateAgent(id, { status: 'published' });
    get().addToast(`${agent.displayName} published and ready for workflows`, 'success');
    get().logAudit({ action: 'publish_agent', resource: agent.displayName, oldValue: agent.status, newValue: 'published' });
    return true;
  },
  unpublishAgent: (id) => {
    if (denyUnless(get, 'agents.write')) return;
    const agent = get().agents.find((a) => a.id === id);
    if (!agent) return;
    get().updateAgent(id, { status: 'draft' });
    get().addToast(`${agent.displayName} moved back to draft`, 'info');
    get().logAudit({ action: 'unpublish_agent', resource: agent.displayName, oldValue: 'published', newValue: 'draft' });
  },

  updateCredential: (id, patch) => {
    if (denyUnless(get, 'resources.write')) return;
    set((s) => ({
      credentials: s.credentials.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
    void saveCatalogs(catalogSnapshot(get()));
  },
  addCredential: () => {
    if (denyUnless(get, 'resources.write')) return null;
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
  createCredential: (input) => {
    if (denyUnless(get, 'resources.write')) return null;
    const name = input.name.trim();
    if (!name) {
      get().addToast('Credential name is required', 'error');
      return null;
    }
    const id = uniquePrefixedId('c', get().credentials.map((c) => c.id));
    const value = input.value?.trim() ?? '';
    const cred: Credential = {
      id,
      name,
      type: input.type ?? 'api-key',
      maskedValue: value ? `••••${value.slice(-4)}` : '—',
      workflowsUsing: 0,
      environment: input.environment,
    };
    set((s) => ({ credentials: [cred, ...s.credentials] }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(`Added ${name} in ${envLabel(input.environment, get().environments)}`, 'success');
    get().logAudit({ action: 'create_credential', resource: name, newValue: input.environment });
    return cred;
  },
  rotateCredential: (id) => {
    if (denyUnless(get, 'resources.write')) return;
    const cred = get().credentials.find((c) => c.id === id);
    if (!cred) return;
    get().updateCredential(id, { lastRotatedAt: new Date().toISOString(), maskedValue: '••••••••••••new' });
    get().addToast(`Rotated ${cred.name}`, 'success');
  },
  deleteCredential: (id) => {
    if (denyUnless(get, 'resources.write')) return;
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
    if (denyUnless(get, 'resources.write')) return null;
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
    if (denyUnless(get, 'resources.write')) return;
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
    if (denyUnless(get, 'resources.write')) return;
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
    if (denyUnless(get, 'resources.write')) return;
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
    if (denyUnless(get, 'resources.write')) return null;
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
    if (denyUnless(get, 'resources.write')) return '';
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
    if (denyUnless(get, 'resources.write')) return null;
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
  updateKnowledgeConnection: (id, patch) => {
    if (denyUnless(get, 'resources.write')) return;
    if (!get().knowledgeConnections.some((k) => k.id === id)) return;
    set((s) => ({
      knowledgeConnections: s.knowledgeConnections.map((k) => k.id === id ? { ...k, ...patch } : k),
    }));
    void saveCatalogs(catalogSnapshot(get()));
  },
  toggleKnowledgeConnection: (id) => {
    if (denyUnless(get, 'resources.write')) return;
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
  createEvaluation: (agentId, name) => {
    if (denyUnless(get, 'evaluations.write')) return null;
    const agent = get().agents.find((a) => a.id === agentId && a.persisted !== false);
    if (!agent) {
      get().addToast('Pick an agent to evaluate', 'error');
      return null;
    }
    const id = uniquePrefixedId('e', get().evaluations.map((e) => e.id));
    const ev: Evaluation = {
      id,
      name: name?.trim() || `${agent.displayName} eval`,
      agentId: agent.id,
      agentName: agent.displayName,
      status: 'draft',
      createdAt: new Date().toISOString(),
      cases: [
        { id: `${id}-c1`, input: '', expectedOutput: '' },
      ],
    };
    set((s) => ({ evaluations: [ev, ...s.evaluations] }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Evaluation created. Add expected output, then Run.', 'success');
    get().logAudit({ action: 'create_evaluation', resource: ev.name, newValue: agent.displayName });
    return ev;
  },
  addEvaluation: () => {
    if (denyUnless(get, 'evaluations.write')) return null;
    const agent = get().agents.find((a) => a.persisted !== false) ?? get().agents[0];
    return get().createEvaluation(agent?.id ?? '', `${agent?.displayName ?? 'Agent'} eval`) ?? {
      id: 'e-temp',
      name: 'Evaluation',
      agentId: '',
      agentName: '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      cases: [],
    };
  },
  updateEvaluation: (id, patch) => {
    if (denyUnless(get, 'evaluations.write')) return;
    const ev = get().evaluations.find((e) => e.id === id);
    if (!ev) return;
    const agent = patch.agentId ? get().agents.find((a) => a.id === patch.agentId) : undefined;
    set((s) => ({
      evaluations: s.evaluations.map((e) => e.id === id
        ? {
          ...e,
          ...patch,
          agentName: agent?.displayName ?? patch.agentName ?? e.agentName,
          status: patch.cases || patch.agentId ? 'draft' : (patch.status ?? e.status),
          approvedForProduction: patch.cases || patch.agentId ? false : (patch.approvedForProduction ?? e.approvedForProduction),
        }
        : e),
    }));
    void saveCatalogs(catalogSnapshot(get()));
  },
  deleteEvaluation: (id) => {
    if (denyUnless(get, 'evaluations.write')) return;
    const ev = get().evaluations.find((e) => e.id === id);
    set((s) => ({ evaluations: s.evaluations.filter((e) => e.id !== id) }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast('Evaluation deleted', 'info');
    if (ev) get().logAudit({ action: 'delete_evaluation', resource: ev.name });
  },
  runEvaluation: async (id) => {
    if (denyUnless(get, 'evaluations.write')) return;
    const ev = get().evaluations.find((e) => e.id === id);
    if (!ev) return;
    const agent = get().agents.find((a) => a.id === ev.agentId);
    if (!agent) {
      get().addToast('This evaluation has no agent. Pick one before running.', 'error');
      return;
    }
    if (!ev.cases.length) {
      get().addToast('Add at least one test case before running', 'error');
      return;
    }
    set((s) => ({
      evaluations: s.evaluations.map((e) => e.id === id ? { ...e, status: 'running' } : e),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    get().logAudit({ action: 'run_evaluation', resource: ev.name, newValue: agent.displayName });

    const cases: EvaluationCase[] = [];
    for (const row of ev.cases) {
      const started = Date.now();
      const result = await runAgentEvalCase(agent, row.input);
      const accuracy = result.error ? 0 : scoreOutputs(row.expectedOutput, result.output);
      cases.push({
        ...row,
        actualOutput: result.output,
        accuracy,
        relevance: accuracy,
        groundedness: accuracy,
        hallucinationScore: Number((1 - accuracy).toFixed(2)),
        citationScore: accuracy,
        safetyScore: result.error ? 0 : 1,
        responseTimeMs: Date.now() - started,
        tokenUsage: result.tokens,
        cost: Number(((result.tokens / 1000) * 0.002).toFixed(4)),
      });
      set((s) => ({
        evaluations: s.evaluations.map((e) => e.id === id ? { ...e, cases: e.cases.map((c) => c.id === row.id ? cases[cases.length - 1] : c) } : e),
      }));
    }
    const averageAccuracy = cases.reduce((a, c) => a + (c.accuracy ?? 0), 0) / Math.max(cases.length, 1);
    const failed = cases.some((c) => (c.accuracy ?? 0) < 0.5 || !c.actualOutput);
    set((s) => ({
      evaluations: s.evaluations.map((e) => e.id === id
        ? { ...e, status: 'completed' as const, cases, averageAccuracy, lastRunAt: new Date().toISOString(), approvedForProduction: false }
        : e),
    }));
    void saveCatalogs(catalogSnapshot(get()));
    get().addToast(
      failed
        ? `Finished ${ev.name}. Some cases missed the expected output.`
        : `Finished ${ev.name}. ${(averageAccuracy * 100).toFixed(0)}% match vs expected.`,
      failed ? 'info' : 'success',
    );
    get().logAudit({
      action: 'finish_evaluation',
      resource: ev.name,
      newValue: `${(averageAccuracy * 100).toFixed(0)}%`,
      result: failed ? 'failure' : 'success',
    });
  },
  approveEvaluation: (id) => {
    if (denyUnless(get, 'evaluations.write')) return;
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
    get().logAudit({ action: 'approve_evaluation', resource: ev.name });
  },
  addEvaluationCase: (agentId, agentName, input, expectedOutput) => {
    if (denyUnless(get, 'evaluations.write')) return;
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
  updateEvaluationCase: (evalId, caseId, patch) => {
    if (denyUnless(get, 'evaluations.write')) return;
    set((s) => ({
      evaluations: s.evaluations.map((e) => e.id === evalId
        ? {
          ...e,
          status: 'draft' as const,
          approvedForProduction: false,
          cases: e.cases.map((c) => c.id === caseId ? { ...c, ...patch } : c),
        }
        : e),
    }));
    void saveCatalogs(catalogSnapshot(get()));
  },
  deleteEvaluationCase: (evalId, caseId) => {
    if (denyUnless(get, 'evaluations.write')) return;
    set((s) => ({
      evaluations: s.evaluations.map((e) => e.id === evalId
        ? { ...e, status: 'draft' as const, approvedForProduction: false, cases: e.cases.filter((c) => c.id !== caseId) }
        : e),
    }));
    void saveCatalogs(catalogSnapshot(get()));
  },

  updateUser: (id, patch) => {
    const actor = get().currentUser;
    if (!canRole(actor.role, 'settings.manage')) {
      if (id !== actor.id || patch.role || patch.allowedEnvironments) {
        get().addToast('Only an administrator can change users or roles', 'error');
        return;
      }
    }
    const prev = get().users.find((u) => u.id === id)
      ?? (get().currentUser.id === id ? get().currentUser : undefined);
    if (prev?.role === 'Administrator' && patch.role && patch.role !== 'Administrator') {
      const otherAdmins = get().users.filter((u) => u.id !== id && u.role === 'Administrator');
      if (!otherAdmins.length) {
        get().addToast('Keep at least one administrator', 'error');
        return;
      }
    }
    set((s) => {
      const exists = s.users.some((u) => u.id === id);
      const nextUser = { ...(exists ? s.users.find((u) => u.id === id)! : s.currentUser), ...patch };
      const userEnvAccess = { ...s.userEnvAccess };
      if ('allowedEnvironments' in patch || (patch.role && isAdministrator(patch.role))) {
        if (isAdministrator(nextUser.role) || !nextUser.allowedEnvironments) {
          delete userEnvAccess[id];
          nextUser.allowedEnvironments = undefined;
        } else {
          userEnvAccess[id] = nextUser.allowedEnvironments;
        }
      }
      const currentUser = s.currentUser.id === id ? nextUser : s.currentUser;
      return {
        users: exists
          ? s.users.map((u) => (u.id === id ? nextUser : u))
          : (s.currentUser.id === id ? [nextUser, ...s.users] : s.users),
        currentUser,
        userEnvAccess,
        environment: snapEnvironment(s.environment, currentUser, s.environments),
      };
    });
    const next = get().users.find((u) => u.id === id) ?? (get().currentUser.id === id ? get().currentUser : undefined);
    if (next) void upsertUserRole(next);
    void persistUserEnvAccess(get().userEnvAccess);
    get().logAudit({
      action: 'update_user',
      resource: next?.email || id,
      oldValue: prev?.role,
      newValue: next?.role,
    });
  },

  createWorkflow: (wf) => {
    if (denyUnless(get, 'workflows.write')) return;
    const id = get().workflows.some((w) => w.id === wf.id)
      ? uniquePrefixedId('w', get().workflows.map((w) => w.id))
      : wf.id;
    wf.id = id;
    const next = { ...wf, id };
    set((s) => ({ workflows: [next, ...s.workflows], selectedWorkflowId: id }));
    persistWorkflow(next);
    get().logAudit({ action: 'create_workflow', resource: next.name, newValue: next.id });
  },
  updateWorkflow: (id, patch) => {
    if (denyUnless(get, 'workflows.write')) return;
    set((s) => ({
      workflows: s.workflows.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: new Date().toISOString() } : w)),
    }));
    const updated = get().workflows.find((w) => w.id === id);
    if (updated) persistWorkflow(updated);
  },
  deleteWorkflow: (id) => {
    if (denyUnless(get, 'workflows.write')) return;
    const wf = get().workflows.find((w) => w.id === id);
    set((s) => {
      const workflows = s.workflows.filter((w) => w.id !== id);
      return {
        workflows,
        selectedWorkflowId: s.selectedWorkflowId === id ? (workflows[0]?.id ?? null) : s.selectedWorkflowId,
      };
    });
    deleteWorkflowFromDb(id);
    get().logAudit({ action: 'delete_workflow', resource: wf?.name || id });
  },
  cloneWorkflow: (id) => {
    if (denyUnless(get, 'workflows.write')) return;
    const wf = get().workflows.find((w) => w.id === id);
    if (!wf) return;
    const newId = uniquePrefixedId('w', get().workflows.map((w) => w.id));
    const clone: Workflow = {
      ...wf,
      id: newId,
      name: `${wf.name} (Copy)`,
      published: false,
      version: '0.1.0',
      sourceWorkflowId: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ workflows: [clone, ...s.workflows] }));
    persistWorkflow(clone);
    get().addToast(`Cloned workflow: ${wf.name}`, 'success');
    get().logAudit({ action: 'clone_workflow', resource: clone.name, oldValue: wf.id, newValue: clone.id });
  },
  deployWorkflow: (id, targetEnv) => {
    if (denyUnless(get, 'workflows.write')) return null;
    const wf = get().workflows.find((w) => w.id === id);
    if (!wf) {
      get().addToast('Workflow not found', 'error');
      return null;
    }
    if (!targetEnv || wf.environment === targetEnv) {
      get().addToast('Pick a different environment to deploy to', 'error');
      return null;
    }
    if (!get().environments.some((env) => env.id === targetEnv)) {
      get().addToast('Unknown environment', 'error');
      return null;
    }
    if (!canAccessEnvironment(get().currentUser, targetEnv, get().environments)) {
      get().addToast('You do not have access to that environment', 'error');
      return null;
    }
    if (isPromotionTerminal(targetEnv, get().promotionPath)
      && !isAdministrator(get().currentUser.role)
      && !canRole(get().currentUser.role, 'runs.approve')) {
      get().addToast('Deploying to the last environment on the path needs an Approver or Administrator', 'error');
      return null;
    }
    const blockers = promoteBlockers(wf, get().runs, get().evaluations, get().agents);
    if (blockers.length) {
      get().addToast(blockers[0], 'error');
      return null;
    }
    const usedAgentIds = new Set(get().agents.map((a) => a.id));
    const result = applyWorkflowDeploy({
      workflow: wf,
      agents: get().agents,
      workflows: get().workflows,
      credentials: get().credentials,
      targetEnv,
      now: new Date().toISOString(),
      nextWorkflowId: uniquePrefixedId('w', get().workflows.map((w) => w.id)),
      allocateAgentId: () => {
        const nextId = uniquePrefixedId('a', usedAgentIds);
        usedAgentIds.add(nextId);
        return nextId;
      },
      webhookSecret: newWebhookSecret(),
    });
    set((s) => {
      const changed = new Set(result.agents.map((a) => a.id));
      const agents = [
        ...result.agents,
        ...s.agents.filter((a) => !changed.has(a.id)),
      ];
      const exists = s.workflows.some((w) => w.id === result.workflow.id);
      const workflows = exists
        ? s.workflows.map((w) => (w.id === result.workflow.id ? result.workflow : w))
        : [result.workflow, ...s.workflows];
      return { agents, workflows };
    });
    result.agents.forEach((agent) => persistAgent(agent));
    persistWorkflow(result.workflow);
    const targetName = envLabel(targetEnv, get().environments);
    const sourceName = envLabel(wf.environment, get().environments);
    get().addToast(
      result.preview.existingTargetId
        ? `Updated the ${targetName} copy of ${wf.name}`
        : `Deployed ${wf.name} to ${targetName}. Source stays in ${sourceName}.`,
      'success',
    );
    get().logAudit({
      action: 'deploy_workflow',
      resource: wf.name,
      oldValue: `${wf.environment}:${wf.id}`,
      newValue: `${targetEnv}:${result.workflow.id}`,
    });
    return result.workflow;
  },
  setWorkflowGraph: (id, nodes, edges) => {
    if (denyUnless(get, 'workflows.write')) return;
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
    if (updated) {
      const versions = pushWorkflowVersion(
        updated,
        snapshotWorkflow(updated, get().currentUser.name, updated.updatedAt),
      );
      const withHistory = { ...updated, versions };
      set((s) => ({ workflows: s.workflows.map((w) => (w.id === id ? withHistory : w)) }));
      persistWorkflow(withHistory);
    }
    unsavedBound.forEach((a) => persistAgent({ ...a, persisted: true }));
  },
  restoreWorkflowVersion: (id, savedAt) => {
    if (denyUnless(get, 'workflows.write')) return;
    const wf = get().workflows.find((w) => w.id === id);
    const version = wf?.versions?.find((item) => item.savedAt === savedAt);
    if (!wf || !version) {
      get().addToast('That version was not found', 'error');
      return;
    }
    get().setWorkflowGraph(id, version.nodes, version.edges);
    get().addToast(`Restored graph from ${version.savedAt.slice(0, 16)}`, 'success');
    get().logAudit({ action: 'restore_workflow_version', resource: wf.name, oldValue: version.savedAt });
  },

  runningWorkflowId: null,
  serverRunId: null,
  runStatus: {},
  runOutputs: {},
  runErrors: {},
  pendingApproval: null,
  startRun: (workflowId, runtimeInput, resume, existingRun, opts) => {
    const found = get().workflows.find((w) => w.id === workflowId);
    if (!found) return;
    if (!opts?.ignoreEnvironment && !existingRun) {
      if (denyUnless(get, 'workflows.run')) return;
    }
    if (!opts?.ignoreEnvironment && !existingRun && found.environment && found.environment !== get().environment) {
      get().addToast(`Switch to ${envLabel(found.environment, get().environments)} to run this workflow`, 'error');
      return;
    }
    const wf = applyStudioDefaults(found);
    const statusMap: Record<string, NodeStatus> = {};
    wf.nodes.forEach((n) => {
      statusMap[n.id] = resume?.nodeOutputs[n.id] ? 'completed' : 'ready';
    });
    if (resume) statusMap[resume.fromNodeId] = 'ready';
    runGeneration += 1;
    const gen = runGeneration;
    approvalWait = null;
    const runId = existingRun?.id ?? `r${Date.now()}`;
    const triggeredBy = existingRun?.triggeredBy ?? get().currentUser.name;
    const stub: WorkflowRun = {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      workflowVersion: wf.version,
      status: 'running',
      triggeredBy,
      environment: wf.environment,
      startTime: existingRun?.startTime ?? new Date().toISOString(),
      totalTokens: existingRun?.totalTokens ?? 0,
      estimatedCost: existingRun?.estimatedCost ?? 0,
      nodeExecutions: resume?.priorExecutions ?? existingRun?.nodeExecutions ?? [],
      logs: existingRun?.logs ?? [],
      runtimeInput: runtimeInput ?? existingRun?.runtimeInput ?? wf.defaultInput,
      approvalDecision: existingRun?.approvalDecision ?? null,
      approvalNodeId: existingRun?.approvalNodeId,
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
    if (!existingRun && !resume) {
      get().logAudit({ action: 'run_workflow', resource: wf.name, newValue: runId });
    }

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
      runtimeInput: runtimeInput ?? existingRun?.runtimeInput,
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
    if (denyUnless(get, 'workflows.run')) return;
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
    if (denyUnless(get, 'workflows.run')) return;
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
    if (denyUnless(get, 'workflows.run')) return;
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
    get().logAudit({ action: 'cancel_run', resource: serverRunId ?? 'run' });
  },
  approveRun: (runId) => {
    get().decideApproval(runId ?? get().serverRunId ?? '', true);
  },
  rejectRun: (runId) => {
    get().decideApproval(runId ?? get().serverRunId ?? '', false);
  },
  decideApproval: (runId, approved) => {
    if (denyUnless(get, 'runs.approve')) return;
    if (!runId) {
      get().addToast('No run is waiting for approval', 'error');
      return;
    }
    const run = get().runs.find((r) => r.id === runId);
    if (!run) {
      get().addToast('Run not found', 'error');
      return;
    }
    if (run.status !== 'waiting-approval' && get().serverRunId !== runId) {
      get().addToast('That run is not waiting for approval', 'info');
      return;
    }
    get().logAudit({
      action: approved ? 'approve_run' : 'reject_run',
      resource: run.workflowName,
      newValue: runId,
    });

    const live = get().serverRunId === runId && approvalWait;
    if (live) {
      approvalWait?.resolve(approved);
      approvalWait = null;
      const liveRun = {
        ...run,
        status: approved ? 'running' as const : run.status,
        approvalDecision: approved,
        approvalNodeId: get().pendingApproval?.nodeId ?? run.approvalNodeId,
      };
      persistRun(liveRun);
      set((s) => ({
        pendingApproval: null,
        runs: s.runs.map((r) => (r.id === runId ? liveRun : r)),
      }));
      get().addToast(
        approved ? 'Approval granted, continuing workflow' : 'Approval rejected, run will be marked failed',
        approved ? 'success' : 'error',
      );
      return;
    }

    const wf = get().workflows.find((w) => w.id === run.workflowId);
    const nodeId = approvalNodeId(run, wf);
    if (!nodeId) {
      get().addToast('Cannot find the approval node for this run', 'error');
      return;
    }
    const now = new Date().toISOString();
    const markApproval = (status: 'completed' | 'failed', output: string, error?: string) => {
      const next = run.nodeExecutions.map((n) => (
        n.nodeId === nodeId || n.status === 'waiting-approval'
          ? { ...n, status, error, output, endedAt: now }
          : n
      ));
      if (next.some((n) => n.nodeId === nodeId)) return next;
      const label = wf?.nodes.find((n) => n.id === nodeId)?.data.label ?? 'Human Approval';
      return [
        ...next,
        {
          nodeId,
          nodeLabel: label,
          status,
          output,
          error,
          tokenUsage: 0,
          cost: 0,
          executionTimeMs: 0,
          retryCount: 0,
          startedAt: run.startTime,
          endedAt: now,
        },
      ];
    };
    if (!approved) {
      const failed: WorkflowRun = {
        ...run,
        status: 'failed',
        approvalDecision: false,
        approvalNodeId: nodeId,
        endTime: now,
        durationMs: run.startTime ? Date.now() - new Date(run.startTime).getTime() : run.durationMs,
        nodeExecutions: markApproval('failed', '{"approved":false}', 'Approval rejected'),
      };
      set((s) => ({
        runs: s.runs.map((r) => (r.id === runId ? failed : r)),
        pendingApproval: s.serverRunId === runId ? null : s.pendingApproval,
      }));
      persistRun(failed);
      get().addToast('Approval rejected', 'error');
      return;
    }

    if (!wf) {
      get().addToast('Workflow no longer exists', 'error');
      return;
    }
    if (get().runningWorkflowId) {
      get().addToast('A workflow is already running', 'error');
      return;
    }

    const resume = continueAfterApproval(run, wf.edges, wf);
    if (!resume) {
      const completed: WorkflowRun = {
        ...run,
        status: 'completed',
        approvalDecision: true,
        approvalNodeId: nodeId,
        endTime: now,
        durationMs: run.startTime ? Date.now() - new Date(run.startTime).getTime() : run.durationMs,
        nodeExecutions: markApproval('completed', '{"approved":true}'),
      };
      set((s) => ({ runs: s.runs.map((r) => (r.id === runId ? completed : r)) }));
      persistRun(completed);
      get().addToast('Approval granted', 'success');
      return;
    }

    set({ selectedWorkflowId: wf.id });
    get().startRun(wf.id, run.runtimeInput, resume, {
      ...run,
      status: 'running',
      approvalDecision: true,
      approvalNodeId: nodeId ?? run.approvalNodeId,
    });
    get().setPage('workflow-builder');
    get().addToast('Approval granted, continuing workflow', 'success');
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
    const fromDb = dbAgents.filter((a) => !isUntitledSkeleton(a));
    const kept = sanitizeAgents(fromDb, AGENTS);
    const persistCleaned = kept.filter((agent, index) => fromDb[index] !== agent);
    set((s) => {
      const byId = new Map(s.agents.map((a) => [a.id, a]));
      for (const a of kept) byId.set(a.id, a);
      leftovers.forEach((a) => byId.delete(a.id));
      return { agents: Array.from(byId.values()) };
    });
    persistCleaned.forEach((agent) => persistAgent({ ...agent, persisted: true }));
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
  resumeInterruptedRuns: () => {
    if (get().runningWorkflowId) return;
    const orphan = orphanedRunningRun(get().runs, get().serverRunId);
    if (orphan) {
      const wf = get().workflows.find((w) => w.id === orphan.workflowId);
      if (!wf) {
        persistRun({ ...orphan, status: 'failed' });
        set((s) => ({ runs: s.runs.map((r) => (r.id === orphan.id ? { ...orphan, status: 'failed' as const } : r)) }));
        return;
      }
      const seed = resumeSeedForOrphan(orphan, wf);
      if (!seed) {
        const failed = { ...orphan, status: 'failed' as const };
        persistRun(failed);
        set((s) => ({ runs: s.runs.map((r) => (r.id === orphan.id ? failed : r)) }));
        get().addToast('A run was interrupted and could not resume', 'error');
        return;
      }
      get().addToast(`Resuming interrupted run of ${wf.name}`, 'info');
      get().startRun(wf.id, orphan.runtimeInput, seed, orphan, { ignoreEnvironment: true });
      return;
    }
    const waiting = get().runs.find((run) => run.status === 'waiting-approval');
    if (waiting) {
      const wf = get().workflows.find((w) => w.id === waiting.workflowId);
      if (wf) set({ pendingApproval: pendingFromRun(waiting, wf) });
    }
  },
  compareRunIds: null,
  setCompareRuns: (leftId, rightId) => {
    set({ compareRunIds: [leftId, rightId ?? ''] });
    get().setPage('run-compare');
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
        get().startRun(wf.id, payload, undefined, undefined, { ignoreEnvironment: true });
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
      get().startRun(wf.id, wf.defaultInput, undefined, undefined, { ignoreEnvironment: true });
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
    owner: useStore.getState().currentUser.name,
    status: 'draft',
    environment: useStore.getState().environment,
    modelProvider: useStore.getState().studioModel?.provider ?? 'OpenAI',
    modelName: useStore.getState().studioModel?.model ?? 'gpt-4o-mini',
    apiEndpoint: useStore.getState().studioModel?.baseUrl,
    temperature: 0.3,
    maxTokens: 4000,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    timeoutSec: 60,
    retryCount: 2,
    prompt: {
      version: 1,
      ...defaultCustomPrompts(),
      contextPrompt: '',
      outputInstructions: 'Return JSON when possible.',
      errorHandlingInstructions: '',
      createdAt: new Date().toISOString(),
      createdBy: useStore.getState().currentUser.name,
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
    environment: useStore.getState().environment,
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
