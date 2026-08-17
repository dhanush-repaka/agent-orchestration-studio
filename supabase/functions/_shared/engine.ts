// Keep in sync with src/lib/engine.ts (Deno imports only).
import type {
  Agent, Workflow, WorkflowRun, WorkflowNode, WorkflowEdge, NodeExecution,
  LogEntry, NodeStatus, NodeRuntimeConfig, InputBinding, RunStatus,
} from "./types.ts";
import { evaluateCondition, getByPath, interpolate, parseJson, type InterpContext } from "./interpolate.ts";

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

export interface EngineCallbacks {
  isCancelled: () => boolean;
  onNodeStatus: (nodeId: string, status: NodeStatus) => void;
  waitForApproval: (nodeId: string, label: string) => Promise<boolean>;
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

function extractAdoWorkItem(upstream: Record<string, unknown>, workflowInput: unknown): Record<string, unknown> | null {
  for (const value of Object.values(upstream)) {
    if (!value || typeof value !== 'object') continue;
    const rec = value as Record<string, unknown>;
    if (rec.normalized && typeof rec.normalized === 'object') return rec.normalized as Record<string, unknown>;
    if (rec.workItemType || rec.acceptanceCriteria || rec.title) return rec;
  }
  if (workflowInput && typeof workflowInput === 'object') return workflowInput as Record<string, unknown>;
  return null;
}

function extractTestCases(upstream: Record<string, unknown>): unknown[] | null {
  const visit = (value: unknown): unknown[] | null => {
    if (!value) return null;
    if (Array.isArray(value) && value.length && typeof value[0] === 'object' && value[0] && 'title' in (value[0] as object)) {
      return value;
    }
    if (typeof value !== 'object') return null;
    const rec = value as Record<string, unknown>;
    for (const key of ['testCases', 'scenarios', 'cases', 'items']) {
      const inner = rec[key];
      const found = visit(inner);
      if (found) return found;
    }
    return null;
  };
  for (const value of Object.values(upstream)) {
    const found = visit(value);
    if (found) return found;
  }
  return null;
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
      adoApiVersion: cfg.adoApiVersion || undefined,
    });
    if (!ok) {
      const err = String(data.error ?? 'ADO retrieval failed');
      return { output: JSON.stringify(data, null, 2), tokens: 0, error: err, toolCalls: [{ tool: 'Azure DevOps', result: err }] };
    }
    return {
      output: JSON.stringify(data, null, 2),
      tokens: Number((data.llmUsage as { total_tokens?: number } | undefined)?.total_tokens ?? 0),
      toolCalls: [{ tool: 'Azure DevOps', result: 'retrieved' }],
    };
  }

  if (agent.type === 'ADO Upload') {
    const testCases = extractTestCases({ ...upstream, inputs: resolvedInputs });
    if (!testCases) {
      return { output: JSON.stringify({ error: 'No test cases found upstream', succeeded: 0, failed: 0, results: [] }, null, 2), tokens: 0, error: 'No test cases found upstream' };
    }
    const ado = extractAdoWorkItem(upstream, workflowInput);
    const sourceWorkItemId = ado?.id ?? resolveWorkItemId(cfg, workflowInput, upstream);
    log('info', 'tool', `Uploading ${testCases.length} work item(s) to Azure DevOps`);
    const { ok, data } = await invoke<Record<string, unknown>>('ado-upload', {
      testCases,
      sourceWorkItemId,
      adoOrg: cfg.adoOrg || undefined,
      adoProject: cfg.adoProject || undefined,
      adoApiVersion: cfg.adoApiVersion || undefined,
      adoWorkItemType: cfg.adoWorkItemType || undefined,
      adoTags: cfg.adoTags || undefined,
      linkToSource: cfg.linkToSource !== false,
      priorityMap: cfg.priorityMap || undefined,
    });
    if (!ok) {
      const err = String(data.error ?? 'ADO upload failed');
      return { output: JSON.stringify(data, null, 2), tokens: 0, error: err, toolCalls: [{ tool: 'Azure DevOps', result: err }] };
    }
    return {
      output: JSON.stringify(data, null, 2),
      tokens: 0,
      toolCalls: [{ tool: 'Azure DevOps', result: `${data.succeeded ?? 0} created` }],
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
  return {
    output: stringifyOutput(result),
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
        case 'condition':
        case 'switch':
        case 'router': {
          const ctx = buildInterpCtx(wf, workflowInput, nodeOutputs, nodes, currentId);
          const truthy = evaluateCondition(String(cfg.expression ?? ''), ctx);
          output = JSON.stringify({ result: truthy, expression: cfg.expression ?? '' });
          addLog('info', 'system', `Condition ${truthy ? 'true' : 'false'}: ${cfg.expression || '(empty)'}`, currentId);
          callbacks.onNodeStatus(currentId, 'completed');
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
          callbacks.onNodeStatus(currentId, 'waiting-approval');
          addLog('info', 'system', `Waiting for approval${cfg.approver ? ` from ${cfg.approver}` : ''}`, currentId);
          await persist('waiting-approval', { approvalNodeId: currentId, approvalDecision: null });
          const approved = await callbacks.waitForApproval(currentId, node.data.label);
          if (callbacks.isCancelled() || !approved) {
            status = 'failed';
            error = approved ? 'Cancelled' : 'Approval rejected';
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
          const items = Array.isArray(fromPath) ? fromPath : null;
          const loopCount = items ? items.length : Math.max(1, Math.min(cfg.loopCount ?? 1, 20));
          output = JSON.stringify({ loopCount, items: items ?? null, path: cfg.loopPath ?? null });
          break;
        }
        case 'parallel':
        case 'merge':
        case 'input':
        case 'output':
        case 'transform':
        case 'filter':
        case 'map':
        case 'json-parser':
          output = predOut || stringifyOutput(workflowInput);
          break;
        default: {
          if (node.data.kind === 'agent') {
            const retries = Math.max(0, cfg.retryCount ?? agent?.retryCount ?? 0);
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

    if (status === 'failed' && wf.failurePolicy === 'abort') {
      addLog('error', 'system', 'Aborting workflow after node failure');
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
