import { create } from 'zustand';
import type {
  Agent, Workflow, WorkflowRun, Environment, NodeStatus,
  WorkflowNode, WorkflowEdge, NodeExecution, LogEntry,
} from '@/types';
import {
  AGENTS, WORKFLOWS, WORKFLOW_RUNS, PROMPTS, CREDENTIALS,
  INTEGRATIONS, EVALUATIONS, AUDIT_LOGS, USERS, CURRENT_USER,
} from '@/data/mock';
import { supabase } from '@/lib/supabase';

async function persistRun(run: WorkflowRun) {
  const { error } = await supabase
    .from('workflow_runs')
    .upsert({ id: run.id, data: run, updated_at: new Date().toISOString() });
  if (error) console.error('Failed to persist run:', error.message);
}

export async function loadRunsFromDb(): Promise<WorkflowRun[]> {
  const { data, error } = await supabase.from('workflow_runs').select('data');
  if (error) {
    console.error('Failed to load runs:', error.message);
    return [];
  }
  return (data ?? []).map((row) => row.data as WorkflowRun);
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

export async function loadAgentsFromDb(): Promise<Agent[]> {
  const { data, error } = await supabase.from('agents').select('data');
  if (error) {
    console.error('Failed to load agents:', error.message);
    return [];
  }
  return (data ?? []).map((row) => row.data as Agent);
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
  const { data, error } = await supabase.from('workflows').select('data');
  if (error) {
    console.error('Failed to load workflows:', error.message);
    return [];
  }
  return (data ?? []).map((row) => row.data as Workflow);
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

  // execution simulation
  runningWorkflowId: string | null;
  runStatus: Record<string, NodeStatus>; // nodeId -> status
  startRun: (workflowId: string, runtimeInput?: string) => void;
  cancelRun: () => void;
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
let runIdCounter = 100;

export const useStore = create<AppState>((set, get) => ({
  page: 'dashboard',
  setPage: (p) => set({ page: p }),
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
    set((s) => ({ agents: [agent, ...s.agents] }));
    persistAgent(agent);
  },
  updateAgent: (id, patch) => {
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)),
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
    const newId = `a${++agentIdCounter}`;
    const clone: Agent = {
      ...agent,
      id: newId,
      name: `${agent.name}-copy`,
      displayName: `${agent.displayName} (Copy)`,
      status: 'draft',
      version: '0.1.0',
      workflowsUsing: 0,
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
    set((s) => ({ workflows: [wf, ...s.workflows] }));
    persistWorkflow(wf);
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
    const newId = `w${++wfIdCounter}`;
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
    set((s) => ({
      workflows: s.workflows.map((w) => (w.id === id ? { ...w, nodes, edges, updatedAt: new Date().toISOString() } : w)),
    }));
    const updated = get().workflows.find((w) => w.id === id);
    if (updated) persistWorkflow(updated);
  },

  runningWorkflowId: null,
  runStatus: {},
  startRun: (workflowId, runtimeInput) => {
    const wf = get().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    const statusMap: Record<string, NodeStatus> = {};
    wf.nodes.forEach((n) => { statusMap[n.id] = 'ready'; });
    set({ runningWorkflowId: workflowId, runStatus: statusMap });

    const runId = `r${++runIdCounter}`;
    const startTime = new Date();
    const nodeExecutions: NodeExecution[] = [];
    const logs: LogEntry[] = [];
    let logId = 0;
    let totalTokens = 0;
    let estimatedCost = 0;
    let runFailed = false;

    const inputJson = runtimeInput ?? wf.defaultInput ?? '{}';
    let parsedInput: Record<string, unknown> = {};
    try { parsedInput = JSON.parse(inputJson); } catch { /* not JSON, treat as raw */ }
    const workItemId = (() => {
      const v = parsedInput.workItemId;
      if (v === undefined) return null;
      const n = Number(v);
      return isNaN(n) ? String(v) : n;
    })();
    const widStr = workItemId !== null ? String(workItemId) : '';

    const addLog = (level: LogEntry['level'], source: LogEntry['source'], message: string, nodeId?: string) => {
      logs.push({
        id: `log-${runId}-${++logId}`,
        runId,
        timestamp: new Date().toISOString(),
        level, source, message, nodeId,
      });
    };

    addLog('info', 'system', `Workflow execution started: ${wf.name}${widStr ? ` (workItemId: ${widStr})` : ''}`);

    const nodeMap = new Map(wf.nodes.map((n) => [n.id, n]));
    const agentMap = new Map(get().agents.map((a) => [a.id, a]));
    const visited = new Set<string>();
    const nodeOutputs: Record<string, string> = {};
    const queue: string[] = wf.nodes.filter((n) => n.data.nodeType === 'start').map((n) => n.id);
    if (queue.length === 0 && wf.nodes.length > 0) queue.push(wf.nodes[0].id);

    const callAdoRetrieval = async (wid: number | string): Promise<string> => {
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ado-retrieval`;
      try {
        const res = await fetch(fnUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ workItemId: Number(wid) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return JSON.stringify({ error: data.error || `ADO retrieval failed (${res.status})`, workItemId: wid }, null, 2);
        }
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : 'Network error', workItemId: wid }, null, 2);
      }
    };

    const fnHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    };

    const callEdgeFunction = async (slug: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> => {
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${slug}`;
      try {
        const res = await fetch(fnUrl, {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false, data: { error: (data as Record<string, unknown>).error ?? `Edge function ${slug} failed (${res.status})` } };
        }
        return { ok: true, data };
      } catch (err) {
        return { ok: false, data: { error: err instanceof Error ? err.message : 'Network error' } };
      }
    };

    // Extract the normalized ADO work item from the most recent Data Retrieval node output.
    const extractAdoWorkItem = (currentNodeId: string): Record<string, unknown> | null => {
      // Find all predecessor node IDs (direct or transitive via BFS through edges).
      const predecessorIds = new Set<string>();
      const queuePre = [currentNodeId];
      while (queuePre.length > 0) {
        const cur = queuePre.shift()!;
        for (const edge of wf.edges) {
          if (edge.target === cur && !predecessorIds.has(edge.source)) {
            predecessorIds.add(edge.source);
            queuePre.push(edge.source);
          }
        }
      }
      // Look for a predecessor node whose agent type is Data Retrieval.
      for (const predId of predecessorIds) {
        const predNode = nodeMap.get(predId);
        const predAgent = predNode?.data.agentId ? agentMap.get(predNode.data.agentId) : undefined;
        if (predAgent?.type === 'Data Retrieval' && nodeOutputs[predId]) {
          try {
            const adoOutput = JSON.parse(nodeOutputs[predId]);
            // The ado-retrieval function returns { normalized: {...}, rawWorkItem: {...} }.
            const normalized = (adoOutput as Record<string, unknown>).normalized;
            if (normalized && typeof normalized === 'object') {
              return normalized as Record<string, unknown>;
            }
            // Fallback: try rawWorkItem.fields if normalized is missing.
            const rawFields = ((adoOutput as Record<string, unknown>).rawWorkItem as Record<string, unknown>)?.fields;
            if (rawFields) {
              const f = rawFields as Record<string, unknown>;
              return {
                id: (adoOutput as Record<string, unknown>).workItemId ?? workItemId,
                title: f['System.Title'] ?? null,
                description: f['System.Description'] ?? null,
                state: f['System.State'] ?? null,
                assignedTo: (f['System.AssignedTo'] as Record<string, unknown>)?.displayName ?? null,
                workItemType: f['System.WorkItemType'] ?? null,
                acceptanceCriteria: (f as Record<string, unknown>)['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? null,
                tags: f['System.Tags'] ? String(f['System.Tags']).split(';').map((t: string) => t.trim()) : [],
                createdDate: f['System.CreatedDate'] ?? null,
                changedDate: f['System.ChangedDate'] ?? null,
              };
            }
          } catch { /* not JSON, skip */ }
        }
      }
      return null;
    };

    // Collect all predecessor outputs as a single merged object for the agent-processor.
    const collectUpstreamData = (currentNodeId: string): Record<string, unknown> => {
      const predecessorIds = new Set<string>();
      const queuePre = [currentNodeId];
      while (queuePre.length > 0) {
        const cur = queuePre.shift()!;
        for (const edge of wf.edges) {
          if (edge.target === cur && !predecessorIds.has(edge.source)) {
            predecessorIds.add(edge.source);
            queuePre.push(edge.source);
          }
        }
      }
      const data: Record<string, unknown> = {};
      for (const predId of predecessorIds) {
        const predNode = nodeMap.get(predId);
        if (!predNode) continue;
        const predAgent = predNode?.data.agentId ? agentMap.get(predNode.data.agentId) : undefined;
        const label = predAgent?.type ?? predNode.data.label ?? predId;
        if (nodeOutputs[predId]) {
          try {
            data[label] = JSON.parse(nodeOutputs[predId]);
          } catch {
            data[label] = nodeOutputs[predId];
          }
        }
      }
      return data;
    };

    const generateAgentOutput = async (agent: Agent | undefined, nodeId: string): Promise<string> => {
      if (!agent) return '{"status":"ok"}';

      switch (agent.type) {
        case 'Data Retrieval': {
          if (workItemId === null) return JSON.stringify({ error: 'workItemId not provided in workflow input' }, null, 2);
          addLog('info', 'tool', `Calling Azure DevOps API for work item ${widStr}...`);
          const adoResult = await callAdoRetrieval(workItemId);
          addLog('info', 'tool', `ADO retrieval completed for work item ${widStr}`);
          return adoResult;
        }

        case 'Requirement Analysis': {
          const adoWorkItem = extractAdoWorkItem(nodeId);
          if (!adoWorkItem) {
            addLog('warning', 'agent', 'No upstream ADO data found — using fallback output', nodeId);
            return JSON.stringify({
              workItemId: workItemId ?? 'unknown',
              title: 'Unknown Requirement',
              businessObjective: 'No upstream ADO work item data available.',
              acceptanceCriteria: [],
              qualityScore: 0,
              gaps: ['No ADO work item data was retrieved upstream.'],
              riskLevel: 'high',
              recommendation: 'Ensure the ADO Work Item Retrieval node runs before this node.',
            }, null, 2);
          }
          addLog('info', 'agent', `Analyzing requirement: ${adoWorkItem.title ?? 'unknown'}...`, nodeId);
          const { ok, data } = await callEdgeFunction('requirement-analysis', { adoWorkItem });
          if (!ok) {
            addLog('warning', 'agent', `Requirement analysis LLM call failed — using fallback. Error: ${(data as Record<string, unknown>).error}`, nodeId);
            return JSON.stringify({
              workItemId: adoWorkItem.id ?? workItemId ?? 'unknown',
              title: adoWorkItem.title ?? 'Unknown',
              businessObjective: (adoWorkItem.description as string ?? '').slice(0, 200) || 'Unable to determine from available data.',
              acceptanceCriteria: adoWorkItem.acceptanceCriteria ? [String(adoWorkItem.acceptanceCriteria)] : [],
              qualityScore: 50,
              gaps: ['LLM analysis unavailable — derived from raw ADO fields.'],
              riskLevel: 'medium',
              recommendation: 'Review manually — LLM analysis failed.',
            }, null, 2);
          }
          addLog('info', 'agent', `Requirement analysis completed`, nodeId);
          return JSON.stringify(data, null, 2);
        }

        case 'Test Case Generator': {
          const adoWorkItem = extractAdoWorkItem(nodeId);
          if (!adoWorkItem) {
            addLog('warning', 'agent', 'No upstream ADO data found — using fallback output', nodeId);
            return JSON.stringify({
              scenarios: [
                { id: 'TS-001', title: 'Fallback test case', description: 'No ADO data available.', preconditions: [], requirementId: `REQ-${widStr || 'unknown'}`, priority: 'medium', type: 'functional', expectedOutcome: 'N/A' },
              ],
            }, null, 2);
          }
          addLog('info', 'agent', `Generating test cases for: ${adoWorkItem.title ?? 'unknown'}...`, nodeId);
          const { ok, data } = await callEdgeFunction('test-case-generation', { adoWorkItem });
          if (!ok) {
            addLog('warning', 'agent', `Test case generation LLM call failed — using fallback. Error: ${(data as Record<string, unknown>).error}`, nodeId);
            return JSON.stringify({
              scenarios: [
                { id: 'TS-001', title: `Test: ${adoWorkItem.title ?? 'unknown'}`, description: `Verify ${adoWorkItem.title ?? 'the requirement'}.`, preconditions: ['Application is accessible'], requirementId: `REQ-${adoWorkItem.id ?? widStr}`, priority: 'critical', type: 'functional', expectedOutcome: 'Expected behavior is confirmed' },
              ],
            }, null, 2);
          }
          addLog('info', 'agent', `Test case generation completed`, nodeId);
          return JSON.stringify(data, null, 2);
        }

        case 'ADO Upload': {
          // Search all upstream nodes for test-case-like data, not just Test Case Generator
          const predecessorIds = new Set<string>();
          const queuePre = [nodeId];
          while (queuePre.length > 0) {
            const cur = queuePre.shift()!;
            for (const edge of wf.edges) {
              if (edge.target === cur && !predecessorIds.has(edge.source)) {
                predecessorIds.add(edge.source);
                queuePre.push(edge.source);
              }
            }
          }
          let testCases: unknown[] | null = null;
          let sourceWorkItemId: number | string | undefined;
          for (const predId of predecessorIds) {
            if (!nodeOutputs[predId]) continue;
            try {
              const tcOutput = JSON.parse(nodeOutputs[predId]) as Record<string, unknown>;
              sourceWorkItemId = tcOutput.sourceWorkItemId ?? workItemId ?? undefined;
              // Try common keys that hold a test-case array
              for (const key of ['testCases', 'scenarios', 'cases', 'items']) {
                const outer = tcOutput[key];
                if (Array.isArray(outer)) {
                  testCases = outer as unknown[];
                  break;
                }
                if (outer && typeof outer === 'object' && !Array.isArray(outer)) {
                  const inner = (outer as Record<string, unknown>)[key];
                  if (Array.isArray(inner)) {
                    testCases = inner as unknown[];
                    break;
                  }
                  const innerScenarios = (outer as Record<string, unknown>).scenarios;
                  if (Array.isArray(innerScenarios)) {
                    testCases = innerScenarios as unknown[];
                    break;
                  }
                }
              }
              if (testCases) break;
              // Fallback: if the output itself is an array of objects with title fields
              if (Array.isArray(tcOutput) && tcOutput.length > 0 && typeof tcOutput[0] === 'object' && 'title' in (tcOutput[0] as Record<string, unknown>)) {
                testCases = tcOutput as unknown[];
                break;
              }
            } catch { /* not JSON, skip */ }
          }
          if (!testCases) {
            addLog('warning', 'agent', 'No upstream test cases found — skipping ADO upload', nodeId);
            return JSON.stringify({ error: 'No test cases found from any upstream node. Place this agent after a node that produces test cases (e.g. Test Case Generator, Requirement Analysis).', succeeded: 0, failed: 0, results: [] }, null, 2);
          }
          addLog('info', 'agent', `Uploading ${testCases.length} test case(s) to Azure DevOps...`, nodeId);
          const { ok, data } = await callEdgeFunction('ado-upload', { testCases, sourceWorkItemId });
          if (!ok) {
            addLog('error', 'agent', `ADO upload failed. Error: ${(data as Record<string, unknown>).error}`, nodeId);
            return JSON.stringify({ error: (data as Record<string, unknown>).error, succeeded: 0, failed: testCases.length, results: [] }, null, 2);
          }
          const uploadResult = data as Record<string, unknown>;
          addLog('info', 'agent', `ADO upload completed: ${uploadResult.succeeded ?? 0} succeeded, ${uploadResult.failed ?? 0} failed`, nodeId);
          return JSON.stringify(data, null, 2);
        }

        case 'Test Data Generator':
        case 'Playwright Automation':
        case 'Code Review':
        case 'Defect Analysis':
        case 'Report Generator': {
          const upstreamData = collectUpstreamData(nodeId);
          if (Object.keys(upstreamData).length === 0) {
            addLog('warning', 'agent', 'No upstream data found — using fallback output', nodeId);
            return getFallbackOutput(agent.type, wf.name);
          }
          addLog('info', 'agent', `Processing ${agent.type} with upstream data...`, nodeId);
          const { ok, data } = await callEdgeFunction('agent-processor', {
            agentType: agent.type,
            upstreamData,
            workflowName: wf.name,
          });
          if (!ok) {
            addLog('warning', 'agent', `${agent.type} LLM call failed — using fallback. Error: ${(data as Record<string, unknown>).error}`, nodeId);
            return getFallbackOutput(agent.type, wf.name);
          }
          addLog('info', 'agent', `${agent.type} completed`, nodeId);
          const result = (data as Record<string, unknown>).result;
          return typeof result === 'string' ? result : JSON.stringify(data, null, 2);
        }

        default: {
          const prev = Object.values(nodeOutputs).filter(Boolean).join('\n');
          return prev ? `{"status":"ok","inputReceived":"${prev.slice(0, 80)}..."}` : '{"status":"ok"}';
        }
      }
    };

    const getFallbackOutput = (agentType: string, workflowName: string): string => {
      switch (agentType) {
        case 'Test Data Generator':
          return JSON.stringify({
            datasets: [
              { scenarioId: 'TS-001', data: { firstName: 'John', lastName: 'Doe', email: 'john.doe@example.com', password: 'Str0ng!Pass' } },
              { scenarioId: 'TS-002', data: { email: 'existing@example.com' } },
              { scenarioId: 'TS-003', data: { password: '123' } },
            ],
          }, null, 2);
        case 'Playwright Automation':
          return `import { test, expect } from '@playwright/test';\n\ntest('Successful user registration', async ({ page }) => {\n  await page.goto('/register');\n  await page.fill('#firstName', 'John');\n  await page.fill('#lastName', 'Doe');\n  await page.fill('#email', 'john.doe@example.com');\n  await page.fill('#password', 'Str0ng!Pass');\n  await page.click('button[type=submit]');\n  await expect(page.locator('.confirmation')).toBeVisible();\n});`;
        case 'Code Review':
          return JSON.stringify({
            score: 8.5,
            issues: [
              { severity: 'medium', message: 'Add explicit wait for navigation after submit.' },
              { severity: 'low', message: 'Consider using a data-testid instead of CSS classes.' },
            ],
            recommendation: 'Approve with minor fixes.',
          }, null, 2);
        case 'Defect Analysis':
          return JSON.stringify({
            defectTitle: 'Registration confirmation not displayed on slow networks',
            severity: 'medium',
            steps: ['Open registration page', 'Enter valid details', 'Submit on throttled network', 'Observe missing confirmation'],
            recommendation: 'Add loading state and retry on timeout.',
          }, null, 2);
        case 'Report Generator':
          return `# Test Execution Report\n\n**Workflow:** ${workflowName}\n**Date:** ${new Date().toISOString()}\n\n## Summary\n- 3 scenarios executed\n- 2 passed, 1 failed\n- Quality score: 82/100\n\n## Details\n1. TS-001 Successful registration — PASSED\n2. TS-002 Duplicate email rejection — PASSED\n3. TS-003 Password complexity — FAILED (weak password accepted)\n\n## Recommendation\nFix password validation before release.`;
        default:
          return '{"status":"ok"}';
      }
    };

    const step = async () => {
      if (get().runningWorkflowId !== workflowId) return; // cancelled
      const currentId = queue.shift();
      if (!currentId) {
        // done — build the run record
        const endTime = new Date();
        const run: WorkflowRun = {
          id: runId,
          workflowId: wf.id,
          workflowName: wf.name,
          workflowVersion: wf.version,
          status: runFailed ? 'failed' : 'completed',
          triggeredBy: get().currentUser.name,
          environment: wf.environment,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationMs: endTime.getTime() - startTime.getTime(),
          totalTokens,
          estimatedCost,
          nodeExecutions,
          logs,
        };
        set((s) => ({ runningWorkflowId: null, runs: [run, ...s.runs] }));
        persistRun(run);
        get().addToast(`Workflow execution ${runFailed ? 'failed' : 'completed'}`, runFailed ? 'error' : 'success');
        return;
      }
      if (visited.has(currentId)) { step(); return; }
      visited.add(currentId);
      const node = nodeMap.get(currentId);
      if (!node) { step(); return; }

      set((s) => ({ runStatus: { ...s.runStatus, [currentId]: 'running' } }));
      const nodeStart = new Date();
      addLog('info', node.data.kind === 'agent' ? 'agent' : 'system', `Executing node: ${node.data.label}`, currentId);

      setTimeout(async () => {
        if (get().runningWorkflowId !== workflowId) return;
        const willFail = node.data.label?.includes('Healing') && node.data.status === 'not-configured';
        const nodeStatus: NodeStatus = willFail ? 'failed' : 'completed';
        set((s) => ({ runStatus: { ...s.runStatus, [currentId]: nodeStatus } }));

        const nodeEnd = new Date();
        const execTime = nodeEnd.getTime() - nodeStart.getTime();
        const tokens = node.data.kind === 'agent' ? Math.floor(800 + Math.random() * 3200) : 0;
        const cost = tokens * 0.00003;
        totalTokens += tokens;
        estimatedCost += cost;

        const agent = node.data.agentId ? agentMap.get(node.data.agentId) : undefined;
        const predecessorOutputs = Object.entries(nodeOutputs)
          .filter(([id]) => wf.edges.some((e) => e.target === currentId && e.source === id))
          .map(([, out]) => out);
        const nodeInput = predecessorOutputs.length > 0
          ? predecessorOutputs.join('\n---\n')
          : inputJson;
        const output = willFail ? undefined : await generateAgentOutput(agent, currentId);
        if (output) nodeOutputs[currentId] = output;
        const ne: NodeExecution = {
          nodeId: currentId,
          nodeLabel: node.data.label,
          agentName: agent?.displayName,
          status: nodeStatus,
          input: nodeInput,
          output,
          prompt: agent?.prompt?.userPromptTemplate,
          model: agent ? `${agent.modelProvider} / ${agent.modelName}` : undefined,
          toolCalls: agent?.tools?.filter((t) => t.enabled).map((t) => ({ tool: t.name, result: 'OK' })),
          knowledge: agent?.knowledge?.map((k) => `${k.type}/${k.collection}`),
          citations: agent?.knowledge?.filter((k) => k.citationRequired).map((k) => `${k.collection}#section-1`),
          tokenUsage: tokens,
          cost,
          executionTimeMs: execTime,
          retryCount: 0,
          error: willFail ? 'Agent not configured' : undefined,
          startedAt: nodeStart.toISOString(),
          endedAt: nodeEnd.toISOString(),
        };
        nodeExecutions.push(ne);

        if (willFail) {
          runFailed = true;
          addLog('error', 'agent', `Node failed: ${node.data.label} — Agent not configured`, currentId);
        } else {
          addLog('info', node.data.kind === 'agent' ? 'agent' : 'system', `Node completed: ${node.data.label}`, currentId);
        }

        // enqueue successors
        const successors = wf.edges.filter((e) => e.source === currentId).map((e) => e.target);
        queue.push(...successors);
        step();
      }, 900);
    };
    step();
  },
  cancelRun: () => {
    set({ runningWorkflowId: null, runStatus: {} });
    get().addToast('Workflow execution cancelled', 'info');
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
    set((s) => {
      const existingIds = new Set(s.agents.map((a) => a.id));
      const merged = [...dbAgents.filter((a) => !existingIds.has(a.id)), ...s.agents];
      return { agents: merged };
    });
  },
  hydrateWorkflows: async () => {
    const dbWorkflows = await loadWorkflowsFromDb();
    if (dbWorkflows.length === 0) return;
    set((s) => {
      const dbMap = new Map(dbWorkflows.map((w) => [w.id, w]));
      const merged = s.workflows.map((w) => dbMap.get(w.id) ?? w);
      const existingIds = new Set(s.workflows.map((w) => w.id));
      const newFromDb = dbWorkflows.filter((w) => !existingIds.has(w.id));
      return { workflows: [...newFromDb, ...merged] };
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
  return {
    id: `a${++agentIdCounter}`,
    name: 'new-agent',
    displayName: 'New Agent',
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
