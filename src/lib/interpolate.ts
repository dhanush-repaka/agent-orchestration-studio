export interface InterpContext {
  workflowInput: unknown;
  previousOutput: unknown;
  environment?: string;
  knowledge?: string;
  nodes: Record<string, { label: string; output: unknown }>;
  inputs?: Record<string, unknown>;
}

export function parseJson(value: string | undefined, fallback: unknown = {}): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function getByPath(obj: unknown, path?: string): unknown {
  if (!path || path === 'output' || path === '.') return obj;
  const clean = path.replace(/^output\.?/, '');
  if (!clean) return obj;
  const parts = clean.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isFinite(idx) ? cur[idx] : undefined;
      continue;
    }
    if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function lookupNode(ctx: InterpContext, key: string): unknown {
  if (ctx.nodes[key]) return ctx.nodes[key].output;
  const byLabel = Object.values(ctx.nodes).find((n) => n.label.toLowerCase() === key.toLowerCase());
  return byLabel?.output;
}

export function interpolate(template: string, ctx: InterpContext): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, raw: string) => {
    const key = raw.trim();
    if (key === 'user_input' || key === 'workflow_input') return stringify(ctx.workflowInput);
    if (key === 'previous_agent_output') return stringify(ctx.previousOutput);
    if (key.startsWith('previous_agent_output.')) {
      return stringify(getByPath(ctx.previousOutput, key.slice('previous_agent_output.'.length)));
    }
    if (key === 'knowledge_context') return ctx.knowledge ?? '';
    if (key === 'current_date') return new Date().toISOString();
    if (key === 'environment') return ctx.environment ?? '';
    if (key.startsWith('workflow.')) return stringify(getByPath(ctx.workflowInput, key.slice('workflow.'.length)));
    if (key.startsWith('inputs.')) return stringify(getByPath(ctx.inputs, key.slice('inputs.'.length)));
    if (key.startsWith('nodes.')) {
      const rest = key.slice('nodes.'.length);
      const [nodeKey, ...pathParts] = rest.split('.');
      const nodeOut = lookupNode(ctx, nodeKey);
      const path = pathParts.join('.').replace(/^output\.?/, '');
      return stringify(path ? getByPath(nodeOut, path) : nodeOut);
    }
    if (ctx.inputs && key in ctx.inputs) return stringify(ctx.inputs[key]);
    return stringify(getByPath(ctx.workflowInput, key));
  });
}

export function evaluateCondition(expression: string, ctx: InterpContext): boolean {
  if (!expression?.trim()) return true;
  const interpolated = interpolate(expression, ctx).trim();
  const cmp = interpolated.match(/^\s*(-?\d+(?:\.\d+)?)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (cmp) {
    const a = Number(cmp[1]);
    const b = Number(cmp[3]);
    switch (cmp[2]) {
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '<': return a < b;
      case '!=': return a !== b;
      default: return a === b;
    }
  }
  const lower = interpolated.toLowerCase();
  if (['true', 'yes', '1'].includes(lower)) return true;
  if (['false', 'no', '0', 'null', 'undefined', ''].includes(lower)) return false;
  try {
    const parsed = JSON.parse(interpolated);
    return Boolean(parsed);
  } catch {
    return interpolated.length > 0;
  }
}
