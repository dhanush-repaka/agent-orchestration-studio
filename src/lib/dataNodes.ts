import type { NodeRuntimeConfig, Workflow, WorkflowEdge, WorkflowNode } from '@/types';
import { evaluateCondition, getByPath, interpolate, parseJson, type InterpContext } from '@/lib/interpolate';

const MAX_LOOP = 20;

export function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function resolveLoopItems(cfg: NodeRuntimeConfig, ctx: InterpContext): unknown[] {
  const fromPath = cfg.loopPath ? getByPath(ctx.previousOutput, cfg.loopPath) : null;
  if (Array.isArray(fromPath)) return fromPath.slice(0, MAX_LOOP);
  if (Array.isArray(ctx.previousOutput)) return ctx.previousOutput.slice(0, MAX_LOOP);
  const count = Math.max(0, Math.min(cfg.loopCount ?? 0, MAX_LOOP));
  if (count > 0) return Array.from({ length: count }, (_, index) => index);
  return [];
}

export function collectLoopBody(
  loopId: string,
  nodes: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
): { body: Set<string>; entries: string[]; exits: WorkflowEdge[] } {
  const body = new Set<string>();
  const entries = edges.filter((edge) => edge.source === loopId).map((edge) => edge.target);
  const queue = [...entries];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === loopId || body.has(id)) continue;
    const node = nodes.get(id);
    if (!node) continue;
    if (node.data.nodeType === 'end' || node.data.nodeType === 'merge') continue;
    body.add(id);
    for (const edge of edges.filter((item) => item.source === id)) queue.push(edge.target);
  }
  const exits = edges.filter((edge) => {
    if (edge.source === loopId && !body.has(edge.target)) return true;
    return body.has(edge.source) && !body.has(edge.target);
  });
  return { body, entries: entries.filter((id) => body.has(id)), exits };
}

export function runTransform(source: unknown, cfg: NodeRuntimeConfig, ctx: InterpContext): unknown {
  const template = cfg.expression || cfg.outputMapping || cfg.inputMapping;
  if (!template?.trim()) return source;
  const rendered = interpolate(template, { ...ctx, previousOutput: source });
  return parseJson(rendered, rendered);
}

export function runFilter(source: unknown, cfg: NodeRuntimeConfig, ctx: InterpContext): unknown {
  const expression = cfg.expression || 'true';
  if (Array.isArray(source)) {
    return source.filter((item) => evaluateCondition(expression, { ...ctx, previousOutput: item, loopItem: item }));
  }
  return evaluateCondition(expression, { ...ctx, previousOutput: source }) ? source : null;
}

export function runMap(source: unknown, cfg: NodeRuntimeConfig, ctx: InterpContext): unknown {
  const template = cfg.expression || cfg.outputMapping || '{{previous_agent_output}}';
  if (!Array.isArray(source)) return runTransform(source, cfg, ctx);
  return source.map((item) => {
    const rendered = interpolate(template, { ...ctx, previousOutput: item, loopItem: item });
    return parseJson(rendered, rendered);
  });
}

export function runJsonParser(source: unknown, cfg: NodeRuntimeConfig): unknown {
  let value: unknown = source;
  if (typeof source === 'string') {
    const match = source.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    value = parseJson(match?.[0] ?? source, source);
  }
  const path = cfg.loopPath || (cfg.expression && !cfg.expression.includes('{{') ? cfg.expression : '');
  return path ? getByPath(value, path) ?? value : value;
}

export function applyDataNode(
  nodeType: string,
  predOut: string,
  cfg: NodeRuntimeConfig,
  ctx: InterpContext,
): unknown {
  const source = predOut ? parseMaybeJson(predOut) : ctx.previousOutput;
  switch (nodeType) {
    case 'transform':
    case 'output':
      return runTransform(source, cfg, ctx);
    case 'filter':
      return runFilter(source, cfg, ctx);
    case 'map':
      return runMap(source, cfg, ctx);
    case 'json-parser':
      return runJsonParser(source, cfg);
    case 'input':
      return ctx.workflowInput;
    default:
      return source;
  }
}

export function collectBranch(
  startId: string,
  nodes: Map<string, WorkflowNode>,
  edges: WorkflowEdge[],
): { body: Set<string>; exits: WorkflowEdge[] } {
  const body = new Set<string>();
  const exits: WorkflowEdge[] = [];
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (body.has(id)) continue;
    const node = nodes.get(id);
    if (!node) continue;
    if (node.data.nodeType === 'end' || node.data.nodeType === 'merge') continue;
    body.add(id);
    for (const edge of edges.filter((item) => item.source === id)) {
      const target = nodes.get(edge.target);
      if (!target || target.data.nodeType === 'end' || target.data.nodeType === 'merge') {
        exits.push(edge);
        continue;
      }
      queue.push(edge.target);
    }
  }
  return { body, exits };
}

export function subgraphFromBody(workflow: Workflow, body: Set<string>, entries: string[]): Workflow {
  const bodyNodes = workflow.nodes.filter((node) => body.has(node.id));
  const bodyEdges = workflow.edges.filter((edge) => body.has(edge.source) && body.has(edge.target));
  const startId = `__loop_start_${workflow.id}`;
  const start: WorkflowNode = {
    id: startId,
    type: 'studioNode',
    position: { x: 0, y: 0 },
    data: { kind: 'control', nodeType: 'start', label: 'Loop item', status: 'ready' },
  };
  const entryEdges: WorkflowEdge[] = entries.map((target) => ({
    id: `__loop_in_${target}`,
    source: startId,
    target,
  }));
  return {
    ...workflow,
    id: `${workflow.id}-loop`,
    nodes: [start, ...bodyNodes],
    edges: [...entryEdges, ...bodyEdges],
  };
}
