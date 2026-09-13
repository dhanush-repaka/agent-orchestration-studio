// Keep in sync with src/lib/engine.ts (Deno imports only).
import type {
  Agent, Workflow, WorkflowRun, WorkflowNode, WorkflowEdge, NodeExecution,
  LogEntry, NodeStatus, NodeRuntimeConfig, InputBinding, RunStatus,
} from "./types.ts";
import { evaluateCondition, getByPath, interpolate, parseJson, type InterpContext } from "./interpolate.ts";
import { collectAdoAttachments, collectAdoRepoFiles } from "./adoArtifacts.ts";
import { extractAdoWorkItem, testCaseGeneratorPrompt } from "./adoWorkItem.ts";
import { defaultAdoRepoName } from "./adoGit.ts";
import {
  buildExecutableSuiteFromCases,
  buildPlaywrightHtmlReport,
  buildQeMarkdownReport,
  extractCodeReview,
  extractGotoPaths,
  extractLocators,
  extractUpstreamLocators,
  extractPlaywrightSpec,
  findLatestPlaywrightExecute,
  isBadCodeReview,
  isRunnerInfrastructureError,
  playwrightUnavailableResult,
  resolveExecutableSpec,
  resolvePlaywrightBaseUrl,
  rewriteSpecUrls,
} from "./playwrightSpec.ts";

export type InvokeFn = <T = unknown>(
  slug: string,
  payload: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; data: T }>;

type AgentProcessorPayload = {
  agentType: string;
  displayName?: string;
  systemPrompt?: string;
  userPrompt?: string;
  outputInstructions?: string;
  outputFormat?: string;
  jsonSchema?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  modelName?: string;
  upstreamData: Record<string, unknown>;
  resolvedInputs?: Record<string, unknown>;
  workflowName?: string;
  workflowInput?: unknown;
};

type AgentProcessorResult = {
  agentType?: string;
  result?: unknown;
  llmUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  error?: string;
};

export type ReplayResume = {
  fromNodeId: string;
  nodeOutputs: Record<string, string>;
  priorExecutions: NodeExecution[];
};

export type ApprovalReview = {
  output?: string;
  approver?: string;
};

export interface EngineCallbacks {
  isCancelled: () => boolean;
  onNodeStatus: (nodeId: string, status: NodeStatus) => void;
  onNodeOutput?: (nodeId: string, output: string, error?: string) => void;
  waitForApproval: (nodeId: string, label: string, review?: ApprovalReview) => Promise<boolean>;
}

function asConfig(raw: unknown): NodeRuntimeConfig {
  const c = (raw ?? {}) as Partial<NodeRuntimeConfig>;
  return {
    ...c,
    timeoutSec: c.timeoutSec ?? 60,
    retryCount: c.retryCount ?? 2,
    loggingLevel: c.loggingLevel ?? 'info',
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function predecessors(nodeId: string, edges: WorkflowEdge[]): string[] {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

function successors(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.filter((e) => e.source === nodeId);
}

function collectAncestorIds(nodeId: string, edges: WorkflowEdge[]): string[] {
  const ids = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const src of predecessors(cur, edges)) {
      if (!ids.has(src)) {
        ids.add(src);
        queue.push(src);
      }
    }
  }
  return [...ids];
}

function buildInterpCtx(
  workflow: Workflow,
  workflowInput: unknown,
  nodeOutputs: Record<string, string>,
  nodes: Map<string, WorkflowNode>,
  currentId: string,
  resolvedInputs?: Record<string, unknown>,
  agent?: Agent,
): InterpContext {
  const prevIds = predecessors(currentId, workflow.edges);
  const previousOutput = prevIds.length
    ? parseMaybeJson(nodeOutputs[prevIds[prevIds.length - 1]] ?? '')
    : workflowInput;
  const nodeMap: InterpContext['nodes'] = {};
  for (const [id, raw] of Object.entries(nodeOutputs)) {
    const n = nodes.get(id);
    nodeMap[id] = { label: n?.data.label ?? id, output: parseMaybeJson(raw) };
  }
  return {
    workflowInput,
    previousOutput,
    environment: workflow.environment,
    knowledge: agent?.knowledge?.map((k) => `${k.type}/${k.collection ?? ''}`).join(', ') ?? '',
    nodes: nodeMap,
    inputs: resolvedInputs,
  };
}

function resolveBindings(
  bindings: InputBinding[] | undefined,
  agent: Agent | undefined,
  workflowInput: unknown,
  nodeOutputs: Record<string, string>,
  workflow: Workflow,
  currentId: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pred = predecessors(currentId, workflow.edges);
  const defaultPredOut = pred[0] ? parseMaybeJson(nodeOutputs[pred[0]] ?? '') : workflowInput;
  const list: InputBinding[] = bindings?.length
    ? bindings
    : (agent?.inputs ?? []).map((inp) => {
        const name = inp.name.toLowerCase();
        if (name.includes('workitem') || name === 'workitemid') {
          return { inputName: inp.name, source: 'workflow' as const, path: 'workItemId' };
        }
        return { inputName: inp.name, source: 'node' as const, path: 'output' };
      });

  for (const b of list) {
    if (b.source === 'static') {
      result[b.inputName] = parseJson(b.staticValue, b.staticValue ?? '');
      continue;
    }
    if (b.source === 'workflow') {
      result[b.inputName] = b.path ? getByPath(workflowInput, b.path) : workflowInput;
      continue;
    }
    const srcId = b.nodeId && nodeOutputs[b.nodeId] ? b.nodeId : pred[0];
    const src = srcId ? parseMaybeJson(nodeOutputs[srcId] ?? '') : defaultPredOut;
    result[b.inputName] = getByPath(src, b.path);
  }
  return result;
}

function collectUpstream(currentId: string, workflow: Workflow, nodeOutputs: Record<string, string>, nodes: Map<string, WorkflowNode>, agents: Map<string, Agent>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const id of collectAncestorIds(currentId, workflow.edges)) {
    if (!nodeOutputs[id]) continue;
    const node = nodes.get(id);
    const agent = node?.data.agentId ? agents.get(node.data.agentId) : undefined;
    const label = agent?.type ?? node?.data.label ?? id;
    data[label] = parseMaybeJson(nodeOutputs[id]);
  }
  return data;
}


function alreadyUploadedTestCases(upstream: Record<string, unknown>): boolean {
  for (const value of Object.values(upstream)) {
    if (!value || typeof value !== 'object') continue;
    const rec = value as Record<string, unknown>;
    if (!Array.isArray(rec.results) || !rec.results.length) continue;
    const sample = rec.results[0];
    if (sample && typeof sample === 'object' && 'success' in (sample as object)) return true;
  }
  return false;
}

function looksLikeUploadResults(value: unknown[]): boolean {
  const sample = value[0] as Record<string, unknown>;
  return 'success' in sample && !('expectedOutcome' in sample) && !('priority' in sample) && !('preconditions' in sample);
}

function extractTestCases(upstream: Record<string, unknown>): unknown[] | null {
  const visit = (value: unknown): unknown[] | null => {
    if (!value) return null;
    if (Array.isArray(value) && value.length && typeof value[0] === 'object' && value[0] && 'title' in (value[0] as object)) {
      if (looksLikeUploadResults(value)) return null;
      return value;
    }
    if (typeof value !== 'object') return null;
    const rec = value as Record<string, unknown>;
    for (const key of ['testCases', 'scenarios', 'cases']) {
      const inner = rec[key];
      const found = visit(inner);
      if (found) return found;
    }
    return null;
  };
  const preferredKeys = Object.keys(upstream).filter((key) => /test case|scenario|inputs/i.test(key));
  for (const key of preferredKeys) {
    const found = visit(upstream[key]);
    if (found) return found;
  }
  for (const [key, value] of Object.entries(upstream)) {
    if (/upload|publish|ado/i.test(key) && !/test case/i.test(key)) continue;
    const found = visit(value);
    if (found) return found;
  }
  return null;
}

function firstAdoAuthError(data: Record<string, unknown>): string | undefined {
  const blob = JSON.stringify(data);
  if (/personal access token[^\n]{0,80}expired|tf401349|access denied/i.test(blob)) {
    return 'Azure DevOps PAT has expired. Save a new PAT on the Credentials page with Work Items and Code (Read & Write).';
  }
  if (/\b401\b/.test(blob) && /ado create failed/i.test(blob)) {
    return 'Azure DevOps rejected the upload (401). Save a new PAT on the Credentials page.';
  }
  return undefined;
}

function resolveWorkItemId(cfg: NodeRuntimeConfig, workflowInput: unknown, upstream: Record<string, unknown>): number | string | null {
  if (cfg.workItemIdSource === 'static' && cfg.staticWorkItemId != null) return cfg.staticWorkItemId;
  if (cfg.workItemIdSource === 'previous-node') {
    const ado = extractAdoWorkItem(upstream, workflowInput);
    const id = ado?.id ?? ado?.workItemId;
    if (id != null) return id as number | string;
  }
  const rec = workflowInput && typeof workflowInput === 'object' ? workflowInput as Record<string, unknown> : {};
  const v = rec.workItemId ?? rec.id;
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n;
}

async function runAgentNode(
  node: WorkflowNode,
  agent: Agent | undefined,
  workflow: Workflow,
  workflowInput: unknown,
  nodeOutputs: Record<string, string>,
  nodes: Map<string, WorkflowNode>,
  agents: Map<string, Agent>,
  log: (level: LogEntry['level'], source: LogEntry['source'], message: string) => void,
  invoke: InvokeFn,
): Promise<{ output: string; tokens: number; model?: string; error?: string; toolCalls?: { tool: string; result: string }[] }> {
  const cfg = asConfig(node.data.config);
  if (!agent) {
    return { output: '{"error":"No agent bound to this node"}', tokens: 0, error: 'No agent bound to this node' };
  }

  const upstream = collectUpstream(node.id, workflow, nodeOutputs, nodes, agents);
  const resolvedInputs = resolveBindings(cfg.inputBindings, agent, workflowInput, nodeOutputs, workflow, node.id);
  const ctx = buildInterpCtx(workflow, workflowInput, nodeOutputs, nodes, node.id, resolvedInputs, agent);
  const enabledTools = agent.tools.filter((t) => {
    if (cfg.enabledToolIds?.length) return cfg.enabledToolIds.includes(t.id) && t.enabled;
    return t.enabled;
  });

  if (agent.type === 'Data Retrieval') {
    const workItemId = resolveWorkItemId(cfg, workflowInput, upstream);
    if (workItemId == null) {
      return { output: JSON.stringify({ error: 'workItemId not provided' }, null, 2), tokens: 0, error: 'workItemId not provided' };
    }
    log('info', 'tool', `Retrieving Azure DevOps work item ${workItemId}`);
    const { ok, data } = await invoke<Record<string, unknown>>('ado-retrieval', {
      workItemId: typeof workItemId === 'number' ? workItemId : Number(workItemId) || workItemId,
      adoOrg: cfg.adoOrg || undefined,
      adoProject: cfg.adoProject || undefined,
      adoApiVersion: cfg.adoApiVersion || undefined,
    });
    if (ok && !data.error) {
      return {
        output: JSON.stringify(data, null, 2),
        tokens: Number((data.llmUsage as { total_tokens?: number } | undefined)?.total_tokens ?? 0),
        toolCalls: [{ tool: 'Azure DevOps', result: 'retrieved' }],
      };
    }
    const rec = workflowInput && typeof workflowInput === 'object' ? workflowInput as Record<string, unknown> : {};
    const fallback = {
      id: workItemId,
      title: rec.title ?? `Work item ${workItemId}`,
      description: rec.description
        ?? 'Azure DevOps retrieval was unavailable. Use only the workflow input fields that were provided.',
      state: rec.state ?? 'Unknown',
      assignedTo: rec.assignedTo ?? null,
      workItemType: rec.workItemType ?? 'Work Item',
      acceptanceCriteria: Array.isArray(rec.acceptanceCriteria) ? rec.acceptanceCriteria : [],
      tags: rec.tags ?? [],
      createdDate: null,
      changedDate: null,
      retrievalError: String(data.error ?? 'ADO retrieval unavailable'),
    };
    log('warning', 'tool', `ADO retrieval unavailable; using workflow input for work item ${fallback.id}`);
    return {
      output: JSON.stringify({ normalized: fallback, source: 'fallback' }, null, 2),
      tokens: 0,
      toolCalls: [{ tool: 'Azure DevOps', result: 'fallback' }],
    };
  }

  if (agent.type === 'ADO Upload') {
    const testCases = extractTestCases({ ...upstream, inputs: resolvedInputs });
    if (!testCases) {
      return { output: JSON.stringify({ error: 'No test cases found upstream', succeeded: 0, failed: 0, results: [] }, null, 2), tokens: 0, error: 'No test cases found upstream' };
    }
    const ado = extractAdoWorkItem(upstream, workflowInput);
    const sourceWorkItemId = ado?.id ?? resolveWorkItemId(cfg, workflowInput, upstream);
    const attachments = collectAdoAttachments({ testCases });
    log('info', 'tool', `Uploading ${testCases.length} test case(s) and ${attachments.length} attachment(s) to Azure DevOps`);
    const { ok, data } = await invoke<Record<string, unknown>>('ado-upload', {
      testCases,
      attachments,
      sourceWorkItemId,
      adoOrg: cfg.adoOrg || undefined,
      adoProject: cfg.adoProject || undefined,
      adoApiVersion: cfg.adoApiVersion || undefined,
      adoWorkItemType: cfg.adoWorkItemType || undefined,
      adoTags: cfg.adoTags || undefined,
      linkToSource: cfg.linkToSource !== false,
      priorityMap: cfg.priorityMap || undefined,
    });
    if (ok && !data.error) {
      const succeeded = Number(data.succeeded ?? 0);
      const failed = Number(data.failed ?? 0);
      if (failed > 0 && succeeded === 0) {
        const err = firstAdoAuthError(data) ?? 'ADO upload failed for every test case';
        log('warning', 'tool', err);
        return {
          output: JSON.stringify({ ...data, error: err, testCases }, null, 2),
          tokens: 0,
          toolCalls: [{ tool: 'Azure DevOps', result: err }],
        };
      }
      return {
        output: JSON.stringify(data, null, 2),
        tokens: 0,
        toolCalls: [{ tool: 'Azure DevOps', result: `${data.succeeded ?? 0} created` }],
      };
    }
    log('warning', 'tool', 'ADO upload unavailable; passing test cases through');
    return {
      output: JSON.stringify({ succeeded: 0, failed: 0, skipped: true, testCases, reason: String(data.error ?? 'ADO upload unavailable') }, null, 2),
      tokens: 0,
      toolCalls: [{ tool: 'Azure DevOps', result: 'skipped' }],
    };
  }

  const systemPrompt = (cfg.systemPromptOverride?.trim() || agent.prompt.systemPrompt || '').trim();
  const userTemplate = (cfg.userPromptOverride?.trim() || agent.prompt.userPromptTemplate || '').trim();
  const userPrompt = userTemplate
    ? interpolate(userTemplate, ctx)
    : `Process the following data as a ${agent.type} agent named "${agent.displayName}".\n\nResolved inputs:\n${JSON.stringify(resolvedInputs, null, 2)}\n\nUpstream:\n${JSON.stringify(upstream, null, 2)}`;

  const payload: AgentProcessorPayload = {
    agentType: agent.type,
    displayName: agent.displayName,
    systemPrompt: systemPrompt || undefined,
    userPrompt,
    outputInstructions: agent.prompt.outputInstructions,
    outputFormat: agent.output.format,
    jsonSchema: agent.output.jsonSchema,
    temperature: cfg.temperature ?? agent.temperature,
    maxTokens: cfg.maxTokens ?? agent.maxTokens,
    topP: cfg.topP ?? agent.topP,
    modelName: agent.modelName,
    upstreamData: Object.keys(upstream).length ? upstream : { workflowInput, inputs: resolvedInputs },
    resolvedInputs,
    workflowName: workflow.name,
    workflowInput,
  };

  if (agent.type === 'Requirement Analysis') {
    const workItem = extractAdoWorkItem(upstream, workflowInput);
    payload.userPrompt = `Analyze the retrieved work item and extract structured requirements. Use this work item as the source of truth. Keep its acceptance criteria and listed scenarios. Do not invent a different product, page, or standard login catalog. Return JSON with workItemId, title, businessObjective, acceptanceCriteria (array), functionalRequirements (array), gaps (array), and qualityScore (0-100).\n\nWork item:\n${stringifyOutput(workItem ?? workflowInput)}\n\nWorkflow input:\n${stringifyOutput(workflowInput)}`;
  }
  if (agent.type === 'Test Case Generator') {
    const workItem = extractAdoWorkItem(upstream, workflowInput);
    payload.userPrompt = testCaseGeneratorPrompt(workItem ?? workflowInput, {
      analysis: resolvedInputs,
      previous: ctx.previousOutput,
    });
  }
  if (agent.type === 'Playwright Automation') {
    const execute = findLatestPlaywrightExecute(nodeOutputs);
    const healing = /heal/i.test(`${node.data.label} ${agent.displayName}`);
    if (healing && isRunnerInfrastructureError(execute?.error)) {
      const spec = extractPlaywrightSpec(stringifyOutput(ctx.previousOutput), upstream);
      if (spec) {
        log('warning', 'agent', 'Playwright runner failed before tests executed; keeping the generated spec');
        return { output: spec, tokens: 0, model: 'passthrough' };
      }
    }
    if (healing) {
      const healCases = extractTestCases({ inputs: resolvedInputs, ...upstream });
      if (healCases?.length) {
        const specHint = extractPlaywrightSpec(stringifyOutput(ctx.previousOutput), upstream);
        log('info', 'agent', `Rebuilding ${healCases.length} Playwright test(s) from generated cases`);
        return {
          output: buildExecutableSuiteFromCases(healCases as Array<{ title?: string; type?: string; description?: string; expectedOutcome?: string }>, {
            specHint,
            locators: extractUpstreamLocators(upstream),
          }),
          tokens: 0,
          model: 'executable-suite',
        };
      }
    }
    const baseUrl = resolvePlaywrightBaseUrl(cfg, workflowInput);
    const cases = extractTestCases({ inputs: resolvedInputs, ...upstream });
    payload.userPrompt = `${payload.userPrompt ?? ''}\n\nTarget application base URL: ${baseUrl}\nUse page.goto with paths from the test cases or this base URL. Return ONLY TypeScript for @playwright/test. Implement real locators, fills, clicks, and assertions. Do not leave TODO or "add logic here" comments.`;
    if (cases?.length) {
      payload.userPrompt = `${payload.userPrompt}\n\nAuthoritative test cases (${cases.length}). Emit exactly one test() per case and use that case title as the test name. Do not add extra tests or drop cases.\n${JSON.stringify(cases)}`;
    }
  }
  if (agent.type === 'Test Data Generator') {
    const cases = extractTestCases({ inputs: resolvedInputs, ...upstream });
    if (cases?.length) {
      payload.userPrompt = `Generate realistic test data for these test cases only. Return JSON { "datasets": [{ "scenarioId", "data" }] }. Ignore Azure DevOps upload or credential errors.\n\n${JSON.stringify(cases)}`;
    }
  }
  if (agent.type === 'Code Change') {
    const review = extractCodeReview({ ...upstream, inputs: resolvedInputs, previous: parseMaybeJson(stringifyOutput(ctx.previousOutput)) });
    const specHint = extractPlaywrightSpec(stringifyOutput(ctx.previousOutput), upstream);
    const changeCases = extractTestCases({ inputs: resolvedInputs, ...upstream });
    if (isBadCodeReview(review) && changeCases?.length) {
      log('warning', 'agent', `Code review score ${review?.score ?? '?'}; rewriting the Playwright spec`);
      return {
        output: buildExecutableSuiteFromCases(changeCases as Array<{ title?: string; type?: string; description?: string; expectedOutcome?: string }>, {
          specHint,
          locators: extractUpstreamLocators(upstream),
        }),
        tokens: 0,
        model: 'code-change',
      };
    }
    if (specHint) {
      log('info', 'agent', 'Code review is acceptable; keeping the current spec');
      return { output: specHint, tokens: 0, model: 'passthrough' };
    }
  }
  if (agent.type === 'Code Review') {
    const spec = extractPlaywrightSpec(stringifyOutput(ctx.previousOutput), { ...upstream, inputs: resolvedInputs });
    const locators = extractUpstreamLocators(upstream);
    if (spec) {
      payload.userPrompt = `Review this Playwright spec. page.goto("") is valid when Playwright baseURL is set. Flag invented locators or page text that is not in the test cases, unimplemented tests, and missing assertions. Return JSON { score (0-10), issues: [{ type, description }], recommendation }.\n\nSpec:\n${spec}\n\nDiscovered locators:\n${JSON.stringify(locators)}`;
    }
  }
  if (agent.type === 'Defect Analysis') {
    const execute = findLatestPlaywrightExecute(nodeOutputs);
    if (execute) {
      payload.userPrompt = `Analyze these Playwright results. If tests timed out, inspect spec URLs and locators first. Do not blame performance when the page is 404 or a locator is missing.\n\n${JSON.stringify({
        passed: execute.passed,
        total: execute.total,
        failed: execute.failed,
        results: execute.results,
        baseUrl: execute.baseUrl,
        error: execute.error,
        spec: typeof execute.spec === 'string' ? execute.spec.slice(0, 4000) : undefined,
      })}`;
    }
  }
  if (agent.type === 'Report Generator') {
    const execute = findLatestPlaywrightExecute(nodeOutputs);
    if (execute) {
      return { output: buildQeMarkdownReport(execute), tokens: 0, model: 'deterministic-report' };
    }
    payload.userPrompt = `${payload.userPrompt ?? ''}\n\nAuthoritative Playwright results (use these; do not write a report that only restates a condition expression):\n${stringifyOutput({ error: 'No Playwright execute result found' })}`;
  }

  log('info', 'agent', `Calling ${agent.displayName} (${agent.modelProvider} / ${agent.modelName})`);
  const { ok, data } = await invoke<AgentProcessorResult>('agent-processor', payload as unknown as Record<string, unknown>);
  if (!ok || data.error) {
    const err = data.error ?? 'Agent processor failed';
    if (agent.output.fallbackResponse) {
      log('warning', 'agent', `${err} — using fallback response`);
      return { output: agent.output.fallbackResponse, tokens: 0, error: err, model: agent.modelName };
    }
    return { output: JSON.stringify({ error: err }, null, 2), tokens: 0, error: err, model: agent.modelName };
  }
  const result = data.result ?? data;
  let output = stringifyOutput(result);
  if (agent.type === 'Code Review') {
    const rec = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};
    output = JSON.stringify({
      ...rec,
      reviewOk: !isBadCodeReview({
        score: Number(rec.score),
        issues: Array.isArray(rec.issues) ? rec.issues : [],
      }),
    }, null, 2);
  }
  return {
    output,
    tokens: data.llmUsage?.total_tokens ?? 0,
    model: data.model ?? `${agent.modelProvider} / ${agent.modelName}`,
    toolCalls: enabledTools.map((t) => ({ tool: t.name, result: 'available' })),
  };
}

function pickConditionEdges(node: WorkflowNode, edges: WorkflowEdge[], truthy: boolean): WorkflowEdge[] {
  const outs = successors(node.id, edges);
  const handle = truthy ? 'out-true' : 'out-false';
  const label = truthy ? 'true' : 'false';
  const byHandle = outs.filter((e) => e.sourceHandle === handle);
  if (byHandle.length) return byHandle;
  const byLabel = outs.filter((e) => String(e.label ?? '').toLowerCase() === label);
  if (byLabel.length) return byLabel;
  if (outs.length === 2) return [outs[truthy ? 0 : 1]];
  return truthy ? outs : [];
}

export async function executeWorkflow(opts: {
  workflow: Workflow;
  agents: Agent[];
  runtimeInput?: string;
  triggeredBy: string;
  callbacks: EngineCallbacks;
  invoke: InvokeFn;
  runId?: string;
  resume?: ReplayResume;
  delayMs?: number;
  persistProgress?: (run: WorkflowRun) => void | Promise<void>;
}): Promise<WorkflowRun> {
  const { workflow: wf, agents, callbacks, invoke } = opts;
  const delayMs = opts.delayMs ?? 280;
  const startTime = new Date();
  const runId = opts.runId ?? `r${Date.now()}`;
  const nodes = new Map(wf.nodes.map((n) => [n.id, n]));
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const nodeOutputs: Record<string, string> = { ...(opts.resume?.nodeOutputs ?? {}) };
  const completed = new Set(Object.keys(opts.resume?.nodeOutputs ?? {}));
  const visited = new Set(completed);
  const nodeExecutions: NodeExecution[] = [...(opts.resume?.priorExecutions ?? [])];
  const logs: LogEntry[] = [];
  let logId = 0;
  let totalTokens = 0;
  let estimatedCost = 0;
  let runFailed = false;
  let runStatus: RunStatus = 'running';

  const inputJson = opts.runtimeInput ?? wf.defaultInput ?? '{}';
  const workflowInput = parseJson(inputJson, inputJson);

  const addLog = (level: LogEntry['level'], source: LogEntry['source'], message: string, nodeId?: string) => {
    logs.push({
      id: `log-${runId}-${++logId}`,
      runId,
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      nodeId,
    });
  };

  const snapshot = (status: RunStatus, extra?: Partial<WorkflowRun>): WorkflowRun => ({
    id: runId,
    workflowId: wf.id,
    workflowName: wf.name,
    workflowVersion: wf.version,
    status,
    triggeredBy: opts.triggeredBy,
    environment: wf.environment,
    startTime: startTime.toISOString(),
    endTime: status === 'running' || status === 'waiting-approval' ? undefined : new Date().toISOString(),
    durationMs: Date.now() - startTime.getTime(),
    totalTokens,
    estimatedCost,
    nodeExecutions: [...nodeExecutions],
    logs: [...logs],
    runtimeInput: typeof inputJson === 'string' ? inputJson : stringifyOutput(inputJson),
    ...extra,
  });

  const persist = async (status: RunStatus, extra?: Partial<WorkflowRun>) => {
    await opts.persistProgress?.(snapshot(status, extra));
  };

  if (opts.resume) {
    const from = nodes.get(opts.resume.fromNodeId);
    addLog('info', 'system', `Replaying from ${from?.data.label ?? opts.resume.fromNodeId} using stored upstream outputs`);
  } else {
    addLog('info', 'system', `Workflow started: ${wf.name}`);
  }

  const queue: string[] = opts.resume
    ? [opts.resume.fromNodeId]
    : wf.nodes.filter((n) => n.data.nodeType === 'start').map((n) => n.id);
  if (!queue.length && wf.nodes.length) queue.push(wf.nodes[0].id);

  await persist('running');

  const enqueue = (edges: WorkflowEdge[]) => {
    for (const edge of edges) {
      const target = nodes.get(edge.target);
      if (!target) continue;
      if (target.data.nodeType === 'merge') {
        const incoming = predecessors(target.id, wf.edges);
        if (incoming.every((id) => completed.has(id))) queue.push(target.id);
        continue;
      }
      queue.push(edge.target);
    }
  };

  while (queue.length) {
    if (callbacks.isCancelled()) {
      runStatus = 'cancelled';
      addLog('warning', 'system', 'Workflow cancelled');
      break;
    }
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    const node = nodes.get(currentId);
    if (!node) continue;
    visited.add(currentId);

    const cfg = asConfig(node.data.config);
    callbacks.onNodeStatus(currentId, 'running');
    const nodeStart = new Date();
    addLog('info', node.data.kind === 'agent' ? 'agent' : 'system', `Executing ${node.data.label}`, currentId);
    if (delayMs > 0) await sleep(delayMs);

    let status: NodeStatus = 'completed';
    let output: string | undefined;
    let error: string | undefined;
    let tokens = 0;
    let model: string | undefined;
    let toolCalls: { tool: string; result: string }[] | undefined;
    const agent = node.data.agentId ? agentMap.get(node.data.agentId) : undefined;
    const predOut = predecessors(currentId, wf.edges)
      .map((id) => nodeOutputs[id])
      .filter(Boolean)
      .join('\n---\n');
    const nodeInput = predOut || inputJson;

    try {
      switch (node.data.nodeType) {
        case 'start':
          output = stringifyOutput(workflowInput);
          break;
        case 'end':
          output = predOut || stringifyOutput(workflowInput);
          break;
        case 'wait':
          await sleep(Math.min(cfg.duration ?? 1000, 15000));
          output = predOut || '{"waited":true}';
          break;
        case 'http-request':
        case 'api-request':
        case 'rest-api': {
          const ctx = buildInterpCtx(wf, workflowInput, nodeOutputs, nodes, currentId, undefined, agent);
          const url = interpolate(cfg.httpUrl ?? '', ctx).trim();
          if (!url) {
            status = 'failed';
            error = 'HTTP URL is not configured';
            output = JSON.stringify({ error });
            break;
          }
          const method = cfg.httpMethod ?? 'POST';
          let headers: Record<string, string> = {};
          const headerText = interpolate(cfg.httpHeaders ?? '{}', ctx);
          const parsedHeaders = parseJson(headerText, {});
          if (parsedHeaders && typeof parsedHeaders === 'object' && !Array.isArray(parsedHeaders)) {
            headers = Object.fromEntries(Object.entries(parsedHeaders as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
          }
          const bodyText = interpolate(cfg.httpBody ?? '{{previous_agent_output}}', ctx);
          const body = parseJson(bodyText, bodyText);
          addLog('info', 'tool', `${method} ${url}`, currentId);
          const { ok, data } = await invoke<Record<string, unknown>>('http-request', {
            method,
            url,
            headers,
            body,
            credentialId: cfg.httpCredentialId || undefined,
          });
          const err = typeof data.error === 'string' ? data.error : undefined;
          if (!ok || err) {
            status = 'failed';
            error = err ?? 'HTTP request failed';
          }
          output = JSON.stringify(data, null, 2);
          toolCalls = [{ tool: 'HTTP Request', result: error ?? `${method} ${url}` }];
          break;
        }
        case 'playwright-mcp': {
          const action = cfg.playwrightAction
            ?? (node.data.label.toLowerCase().includes('execute') || node.data.label.toLowerCase().includes('re-run')
              ? 'execute'
              : 'locators');
          const upstream = collectUpstream(currentId, wf, nodeOutputs, nodes, agentMap);
          const extracted = extractPlaywrightSpec(predOut, { ...upstream, previous: parseMaybeJson(predOut) });
          const locators = extractUpstreamLocators(upstream);
          const spec = resolveExecutableSpec(extracted, { workflowInput, upstream, previous: parseMaybeJson(predOut) }, locators);
          const baseUrl = resolvePlaywrightBaseUrl(cfg, workflowInput);
          if (action === 'execute') {
            if (!spec) {
              const missing = playwrightUnavailableResult('No Playwright spec found upstream. Code generation must emit @playwright/test TypeScript.');
              output = JSON.stringify(missing, null, 2);
              error = String(missing.error);
              status = 'failed';
              addLog('error', 'tool', error, currentId);
              break;
            }
            addLog('info', 'tool', `Running Playwright against ${baseUrl}`, currentId);
            const { ok, data } = await invoke<Record<string, unknown>>('playwright-execute', {
              spec: rewriteSpecUrls(spec, baseUrl),
              baseUrl,
              locators,
              timeoutSec: cfg.timeoutSec,
            });
            const unavailable = data.source === 'unavailable'
              || data.code === 'NOT_FOUND'
              || String(data.message ?? '').includes('Requested function was not found')
              || (!ok && !Array.isArray(data.results) && data.passed !== true);
            const err = typeof data.error === 'string'
              ? data.error
              : unavailable
                ? 'Playwright runner is not available on this host. qefoundry.com functions stop at 26s; run the suite locally with npm run dev.'
                : undefined;
            if (unavailable) {
              status = 'failed';
              error = err;
            }
            output = JSON.stringify({
              ...data,
              passed: data.passed === true,
              source: data.source ?? (ok ? 'playwright' : 'unavailable'),
              spec,
              htmlReport: typeof data.htmlReport === 'string' && data.htmlReport.trim()
                ? data.htmlReport
                : buildPlaywrightHtmlReport({ ...data, spec, baseUrl }),
            }, null, 2);
            addLog(
              data.passed === true ? 'info' : 'warning',
              'tool',
              `Playwright execute: ${data.passed === true ? 'passed' : 'failed'}${err ? ` — ${err}` : ''}`,
              currentId,
            );
          } else {
            const fromSpec = extractLocators(spec || predOut);
            const { ok, data } = await invoke<Record<string, unknown>>('playwright-locators', {
              baseUrl,
              spec,
              paths: extractGotoPaths(spec || predOut),
            });
            const live = ok && Array.isArray(data.locators) ? data.locators.map(String) : [];
            const discovered = live.length ? live : fromSpec;
            output = JSON.stringify({
              locators: discovered.length ? discovered : ['page.locator("body")'],
              source: live.length ? 'playwright' : 'playwright-mcp',
              spec: spec || predOut,
              baseUrl,
              pages: data.pages ?? null,
            }, null, 2);
            addLog('info', 'tool', `Discovered ${discovered.length || 1} locator(s)`, currentId);
          }
          toolCalls = [{ tool: 'Playwright', result: action }];
          break;
        }
        case 'azure-devops':
        case 'azure-devops-mcp': {
          const upstream = collectUpstream(currentId, wf, nodeOutputs, nodes, agentMap);
          const testCases = extractTestCases({ ...upstream, previous: parseMaybeJson(predOut) });
          const ado = extractAdoWorkItem(upstream, workflowInput);
          const fromAdo = ado?.id ?? ado?.workItemId;
          const sourceWorkItemId = (typeof fromAdo === 'string' || typeof fromAdo === 'number')
            ? fromAdo
            : resolveWorkItemId(cfg, workflowInput, upstream);
          const attachments = collectAdoAttachments({
            upstream,
            nodeOutputs,
            testCases,
          });
          const repoFiles = collectAdoRepoFiles({
            upstream,
            nodeOutputs,
            sourceWorkItemId,
          });
          const casesToCreate = alreadyUploadedTestCases(upstream) ? [] : (testCases ?? []);
          if (casesToCreate.length || attachments.length || repoFiles.length) {
            addLog(
              'info',
              'tool',
              `Publishing ${casesToCreate.length} test case(s), ${attachments.length} attachment(s), and ${repoFiles.length} repo file(s) to Azure DevOps`,
              currentId,
            );
            const execute = findLatestPlaywrightExecute(nodeOutputs);
            const { ok, data } = await invoke<Record<string, unknown>>('ado-upload', {
              testCases: casesToCreate,
              attachments,
              repoFiles,
              playwrightArtifactDir: typeof execute?.artifactDir === 'string' ? execute.artifactDir : undefined,
              adoRepoName: cfg.adoRepoName || defaultAdoRepoName(sourceWorkItemId, typeof ado?.title === 'string' ? ado.title : undefined),
              sourceWorkItemId,
              adoOrg: cfg.adoOrg || undefined,
              adoProject: cfg.adoProject || undefined,
              adoApiVersion: cfg.adoApiVersion || undefined,
              adoWorkItemType: cfg.adoWorkItemType || undefined,
              adoTags: cfg.adoTags || undefined,
              linkToSource: cfg.linkToSource !== false,
            });
            if (ok && !data.error) {
              output = JSON.stringify(data, null, 2);
              const repoName = data.repository && typeof data.repository === 'object'
                ? String((data.repository as { repoName?: string }).repoName ?? '')
                : '';
              toolCalls = [{
                tool: 'Azure DevOps',
                result: `${data.succeeded ?? 0} test case(s), ${data.attached ?? attachments.length} file(s)${repoName ? `, repo ${repoName}` : ''}`,
              }];
              break;
            }
          }
          output = JSON.stringify({
            published: true,
            skippedRemote: true,
            workItemId: ado?.id ?? sourceWorkItemId,
            attachments: attachments.map((file) => file.fileName),
            repoFiles: repoFiles.map((file) => file.path),
            report: predOut || stringifyOutput(workflowInput),
          }, null, 2);
          toolCalls = [{ tool: 'Azure DevOps', result: 'recorded locally' }];
          break;
        }
        case 'condition':
        case 'switch':
        case 'router': {
          const ctx = buildInterpCtx(wf, workflowInput, nodeOutputs, nodes, currentId);
          const truthy = evaluateCondition(String(cfg.expression ?? ''), ctx);
          const execute = findLatestPlaywrightExecute(nodeOutputs);
          output = JSON.stringify({
            result: truthy,
            passed: truthy,
            expression: cfg.expression ?? '',
            evaluated: interpolate(String(cfg.expression ?? ''), ctx),
            execute,
            workItemId: workflowInput && typeof workflowInput === 'object'
              ? (workflowInput as Record<string, unknown>).workItemId ?? null
              : null,
          });
          addLog('info', 'system', `Condition ${truthy ? 'true' : 'false'}: ${cfg.expression || '(empty)'}`, currentId);
          callbacks.onNodeStatus(currentId, 'completed');
          callbacks.onNodeOutput?.(currentId, output);
          completed.add(currentId);
          nodeOutputs[currentId] = output;
          enqueue(pickConditionEdges(node, wf.edges, truthy));
          nodeExecutions.push({
            nodeId: currentId,
            nodeLabel: node.data.label,
            status: 'completed',
            input: nodeInput,
            output,
            tokenUsage: 0,
            cost: 0,
            executionTimeMs: Date.now() - nodeStart.getTime(),
            retryCount: 0,
            startedAt: nodeStart.toISOString(),
            endedAt: new Date().toISOString(),
          });
          await persist('running');
          continue;
        }
        case 'approval': {
          const review = predOut || nodeInput;
          callbacks.onNodeStatus(currentId, 'waiting-approval');
          addLog('info', 'system', `Waiting for approval${cfg.approver ? ` from ${cfg.approver}` : ''}`, currentId);
          await persist('waiting-approval', {
            approvalNodeId: currentId,
            approvalDecision: null,
            approvalReview: review,
          });
          const approved = await callbacks.waitForApproval(currentId, node.data.label, {
            output: review,
            approver: cfg.approver,
          });
          if (callbacks.isCancelled()) {
            runStatus = 'cancelled';
            status = 'failed';
            error = 'Cancelled';
            runFailed = true;
            output = JSON.stringify({ approved: false, cancelled: true });
          } else if (!approved) {
            status = 'failed';
            error = 'Approval rejected';
            runFailed = true;
            output = JSON.stringify({ approved: false });
          } else {
            output = JSON.stringify({ approved: true, approver: cfg.approver ?? null });
          }
          break;
        }
        case 'loop': {
          const ctx = buildInterpCtx(wf, workflowInput, nodeOutputs, nodes, currentId);
          const fromPath = cfg.loopPath ? getByPath(ctx.previousOutput, cfg.loopPath) : null;
          const items = Array.isArray(fromPath) ? fromPath.slice(0, 20) : Array.isArray(ctx.previousOutput)
            ? ctx.previousOutput.slice(0, 20)
            : Array.from({ length: Math.max(0, Math.min(cfg.loopCount ?? 0, 20)) }, (_, i) => i);
          output = JSON.stringify({ loopCount: items.length, items, path: cfg.loopPath ?? null });
          break;
        }
        case 'parallel':
        case 'merge':
          output = predOut || stringifyOutput(workflowInput);
          break;
        case 'input':
          output = stringifyOutput(workflowInput);
          break;
        case 'output':
        case 'transform':
        case 'filter':
        case 'map':
        case 'json-parser': {
          const ctx = buildInterpCtx(wf, workflowInput, nodeOutputs, nodes, currentId);
          const source = predOut ? parseMaybeJson(predOut) : ctx.previousOutput;
          if (node.data.nodeType === 'filter' && Array.isArray(source)) {
            output = stringifyOutput(source.filter((item) => evaluateCondition(cfg.expression || 'true', { ...ctx, previousOutput: item })));
          } else if ((node.data.nodeType === 'transform' || node.data.nodeType === 'output' || node.data.nodeType === 'map') && (cfg.expression || cfg.outputMapping)) {
            const rendered = interpolate(cfg.expression || cfg.outputMapping || '', { ...ctx, previousOutput: source });
            output = stringifyOutput(parseJson(rendered, rendered));
          } else if (node.data.nodeType === 'json-parser') {
            output = stringifyOutput(typeof source === 'string' ? parseJson(source, source) : source);
          } else {
            output = stringifyOutput(source);
          }
          break;
        }
        default: {
          if (node.data.kind === 'agent') {
            const toolAgent = agent?.type === 'Data Retrieval' || agent?.type === 'ADO Upload';
            const retries = toolAgent ? 0 : Math.max(0, cfg.retryCount ?? agent?.retryCount ?? 0);
            let last: Awaited<ReturnType<typeof runAgentNode>> | null = null;
            for (let attempt = 0; attempt <= retries; attempt++) {
              last = await runAgentNode(node, agent, wf, workflowInput, nodeOutputs, nodes, agentMap, (l, s, m) => addLog(l, s, m, currentId), invoke);
              if (!last.error) break;
              if (attempt < retries) addLog('warning', 'agent', `Retry ${attempt + 1}/${retries}: ${last.error}`, currentId);
            }
            output = last?.output;
            error = last?.error;
            tokens = last?.tokens ?? 0;
            model = last?.model ?? (agent ? `${agent.modelProvider} / ${agent.modelName}` : undefined);
            toolCalls = last?.toolCalls;
            if (error) status = 'failed';
          } else {
            output = predOut || '{"status":"ok"}';
          }
        }
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : 'Node failed';
      output = JSON.stringify({ error });
    }

    if (status === 'failed') {
      runFailed = true;
      addLog('error', node.data.kind === 'agent' ? 'agent' : 'system', `Failed: ${node.data.label}${error ? ` — ${error}` : ''}`, currentId);
    } else {
      addLog('info', node.data.kind === 'agent' ? 'agent' : 'system', `Completed: ${node.data.label}`, currentId);
    }

    if (output) nodeOutputs[currentId] = output;
    const cost = tokens * 0.00003;
    totalTokens += tokens;
    estimatedCost += cost;
    callbacks.onNodeStatus(currentId, status);
    callbacks.onNodeOutput?.(currentId, output ?? '', error);
    completed.add(currentId);
    nodeExecutions.push({
      nodeId: currentId,
      nodeLabel: node.data.label,
      agentName: agent?.displayName,
      status,
      input: nodeInput,
      output,
      prompt: agent?.prompt?.userPromptTemplate,
      model,
      toolCalls,
      knowledge: agent?.knowledge?.map((k) => `${k.type}/${k.collection}`),
      tokenUsage: tokens,
      cost,
      executionTimeMs: Date.now() - nodeStart.getTime(),
      retryCount: 0,
      error,
      startedAt: nodeStart.toISOString(),
      endedAt: new Date().toISOString(),
    });

    const abortNow = status === 'failed' && (
      wf.failurePolicy === 'abort'
      || node.data.nodeType === 'approval'
      || runStatus === 'cancelled'
    );
    if (abortNow) {
      addLog(
        'error',
        'system',
        error === 'Approval rejected'
          ? 'Approval rejected, workflow stopped'
          : runStatus === 'cancelled'
            ? 'Workflow cancelled'
            : 'Aborting workflow after node failure',
      );
      await persist(runStatus === 'cancelled' ? 'cancelled' : 'running');
      break;
    }

    if (node.data.nodeType !== 'end') {
      enqueue(successors(currentId, wf.edges));
    }
    await persist('running');
  }

  const endTime = new Date();
  if (runStatus !== 'cancelled') runStatus = runFailed ? 'failed' : 'completed';
  addLog('info', 'system', `Workflow ${runStatus}`);
  const finished = snapshot(runStatus, {
    endTime: endTime.toISOString(),
    durationMs: endTime.getTime() - startTime.getTime(),
    approvalDecision: null,
    approvalNodeId: undefined,
  });
  await opts.persistProgress?.(finished);
  return finished;
}
